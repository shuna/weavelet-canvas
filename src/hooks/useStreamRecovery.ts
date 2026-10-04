import { recordOpenRouterObservation } from '@utils/openrouterObservation';
import { observeOpenRouterUsage } from '@utils/openrouterControls';
import { useEffect, useRef } from 'react';
import useStore from '@store/store';
import { getAllPending, deleteRequest, markAcknowledged, saveProxyCheckpoint, StreamRecord } from '@utils/streamDb';
import { upsertActivePathMessage } from '@utils/branchUtils';
import { cloneChatAtIndex } from '@utils/chatShallowClone';
import { register } from '@utils/swBridge';
import {
  fetchProxyRecovery,
  sendAck,
  parseProxySse,
  type ProxyConfig,
} from '@utils/proxyClient';
import { parseEventSource } from '@api/helper';
import { ThinkTagParser } from '@utils/thinkTagParser';
import { extractTextFromApiContent, extractReasoningFromApiContent, extractReasoningFromReasoningDetails } from '@utils/apiContent';
import { debugReport } from '@store/debug-store';
import { useStreamEndStatusStore } from '@store/stream-end-status-store';
import { showToast } from '@utils/showToast';
import {
  buildVerifiedStatsKey,
  OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
} from '@utils/openrouterVerification';
import {
  buildRecoveredMessage,
  findRecoverableChat,
  getCurrentMessageText,
  hasRecoverableMessage,
  resolveRecoveryStatus,
  shouldApplyRecoveredText,
} from './streamRecoveryHelpers';

const VISIBILITY_THRESHOLD_MS = 3000;
const formatDebugTime = (time = Date.now()): string =>
  new Date(time).toISOString().slice(11, 23);

/** Module-level lock to prevent concurrent recoverPending calls (e.g. StrictMode double-mount) */
let recoveryInProgress = false;

/** Module-level AbortController for cancelling in-flight proxy recovery */
let activeRecoveryAbort: AbortController | null = null;
let recoveryCancelledManually = false;

/** Cancel any in-flight proxy recovery. Called externally for manual stop. */
export function cancelActiveRecovery(silent = false) {
  if (activeRecoveryAbort) {
    recoveryCancelledManually = true;
    activeRecoveryAbort.abort();
    activeRecoveryAbort = null;
  }
  if (!silent) {
    debugReport('recovery-hook', {
      label: 'Recovery Hook',
      status: 'done',
      detail: `${formatDebugTime()} cancelled`,
    });
  }
}

/**
 * Cancel active recovery AND purge all pending IndexedDB records so recovery
 * will not re-trigger on next startup or visibility change.
 * When silent=true, no debugReport is emitted (used by debug panel to avoid
 * re-creating the entry that was just removed).
 */
export async function cancelAndPurgeRecovery(silent = false) {
  cancelActiveRecovery(silent);
  try {
    const records = await getAllPending();
    for (const r of records) {
      await deleteRequest(r.requestId);
    }
  } catch {
    // best-effort cleanup
  }
  if (!silent) {
    debugReport('recovery-hook', {
      label: 'Recovery Hook',
      status: 'done',
      detail: `${formatDebugTime()} purged all pending records`,
    });
  }
}

export default function useStreamRecovery() {
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Register SW on mount
    register();
    // Recover any pending records from a previous session (cold start)
    recoverPending();
  }, []);

  useEffect(() => {
    const onPageShow = () => {
      if (hiddenAtRef.current) {
        hiddenAtRef.current = null;
        debugReport('recovery-hook', {
          label: 'Recovery Hook',
          status: 'active',
          detail: `${formatDebugTime()} pageshow -> recover`,
        });
        recoverPending();
      }
    };

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        debugReport('recovery-hook', {
          label: 'Recovery Hook',
          status: 'active',
          detail: `${formatDebugTime()} hidden`,
        });
        return;
      }

      // Foreground
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;

      // Suppress for short background durations
      if (hiddenAt && Date.now() - hiddenAt < VISIBILITY_THRESHOLD_MS) return;

      debugReport('recovery-hook', {
        label: 'Recovery Hook',
        status: 'active',
        detail: `${formatDebugTime()} visible -> recover`,
      });
      recoverPending();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}

/** Max retry attempts when proxy returns an 'interrupted' event (Worker may still be writing) */
const PROXY_RECOVERY_MAX_RETRIES = 3;
const PROXY_RECOVERY_RETRY_DELAY_MS = 500;

/** Timeout for the entire proxy recovery SSE stream read (ms) */
const PROXY_RECOVERY_STREAM_TIMEOUT_MS = 120_000; // 2 minutes

/** Max time to wait for store hydration before giving up (ms) */
const HYDRATION_TIMEOUT_MS = 10_000;

/** Wait for Zustand store hydration to complete (proxy credentials aren't available until then) */
async function waitForStoreHydration(): Promise<boolean> {
  if (useStore.persist.hasHydrated()) return true;

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, HYDRATION_TIMEOUT_MS);

    const unsub = useStore.persist.onFinishHydration(() => {
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

/** Try to recover additional text from the proxy's KV cache */
type ProxyRecoveryResult = { text: string; reasoning: string; outcome: 'complete' | 'partial' | 'network' | 'abort'; retryAfterMs?: number; retry?: boolean };

const appendRecoveredEvent = (event: any, parser: ThinkTagParser, result: { text: string; reasoning: string }) => {
  const delta = event.choices?.[0]?.delta;
  if (!delta) return;
  const reasoning = typeof delta.reasoning === 'string' ? delta.reasoning
    : typeof delta.reasoning_content === 'string' ? delta.reasoning_content
    : extractReasoningFromReasoningDetails(delta.reasoning_details)
      || extractReasoningFromApiContent(delta.content as never);
  result.reasoning += reasoning || '';
  const parsed = parser.process(extractTextFromApiContent(delta.content as never));
  result.text += parsed.content;
  result.reasoning += parsed.reasoning;
};

async function tryProxyRecovery(
  record: StreamRecord,
  currentText: string,
  signal: AbortSignal
): Promise<ProxyRecoveryResult | null> {
  const { proxyEnabled, proxyEndpoint, proxyAuthToken } = useStore.getState();
  if (!proxyEnabled || !proxyEndpoint || !record.proxySessionId) return null;

  const config: ProxyConfig = {
    endpoint: proxyEndpoint.replace(/\/+$/, ''),
    authToken: proxyAuthToken || undefined,
  };

  let best: ProxyRecoveryResult | null = null;

  for (let attempt = 0; attempt <= PROXY_RECOVERY_MAX_RETRIES; attempt++) {
    if (signal.aborted) break;

    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, best?.retryAfterMs ?? PROXY_RECOVERY_RETRY_DELAY_MS));
    }

    if (signal.aborted) break;

    const result = await readProxyRecoveryStream(config, record, signal);
    if (!result) return { text: record.bufferedText, reasoning: record.bufferedReasoning ?? '', outcome: signal.aborted ? 'abort' : 'network' };

    if (result.text.length + result.reasoning.length > ((best?.text.length ?? 0) + (best?.reasoning.length ?? 0))) {
      best = result;
    }

    if (result.outcome === 'complete' || result.outcome === 'abort') return result;
    if (result.outcome === 'network' || (result.outcome === 'partial' && result.retry)) {
      best = result;
      continue;
    }
  }
  return best ?? { text: currentText, reasoning: record.bufferedReasoning ?? '', outcome: signal.aborted ? 'abort' : 'partial' };
}

async function readProxyRecoveryStream(
  config: ProxyConfig,
  record: StreamRecord,
  signal: AbortSignal
): Promise<ProxyRecoveryResult | null> {
  let response: Response;
  try {
    response = await fetchProxyRecovery(config, record.proxySessionId!, record.lastProxyEventId ?? 0, signal);
  } catch {
    return { text: record.bufferedText, reasoning: record.bufferedReasoning ?? '', outcome: signal.aborted ? 'abort' : 'network' };
  }
  if (!response.ok || !response.body) {
    const retry = response.headers.get('Retry-After');
    await response.body?.cancel().catch(() => {});
    const seconds = Number(retry);
    const retryAfterMs = Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1000, 0), 5_000) : undefined;
    return { text: record.bufferedText, reasoning: record.bufferedReasoning ?? '', outcome: 'network', retryAfterMs };
  }
  const stream = response.body;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let partial = '';
  let llmPartial = record.llmSsePartial ?? '';
  let recoveredText = record.bufferedText;
  let recoveredReasoning = record.bufferedReasoning ?? '';
  const thinkParser = new ThinkTagParser();
  if (record.thinkTagCheckpoint) thinkParser.restore(record.thinkTagCheckpoint);
  let outcome: ProxyRecoveryResult['outcome'] = 'network';
  let sawLlmDone = record.llmDone === true;
  let retry = false;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) {
        outcome = 'abort';
        break;
      }

      const { done, value } = await reader.read();
      const chunk = partial + decoder.decode(done ? undefined : value, { stream: !done });
      const proxySse = parseProxySse(chunk, done);
      partial = proxySse.partial;

      let shouldBreak = false;
      for (const evt of proxySse.events) {
        if (evt.id > (record.lastProxyEventId ?? 0)) record.lastProxyEventId = evt.id;
        if (evt.eventType === 'interrupted') {
          outcome = 'partial';
          shouldBreak = true;
          break;
        }
        if (evt.eventType === 'cache-miss') {
          outcome = 'partial';
          retry = true;
          shouldBreak = true;
          break;
        }
        if (evt.eventType === 'done' || evt.eventType === 'error') {
          if (evt.meta?.openRouterObservation) record.openRouterObservation = { ...record.openRouterObservation, ...evt.meta.openRouterObservation };
          outcome = evt.eventType === 'done' && evt.meta?.complete === true && evt.meta?.cacheCapability !== 'overflow' && sawLlmDone ? 'complete' : 'partial';
          shouldBreak = true;
          break;
        }
        if (evt.eventType === 'waiting') {
          // Server is still streaming — continue reading
          continue;
        }
        if (evt.rawText) {
          const llmChunk = llmPartial + evt.rawText;
          const llmParsed = parseEventSource(llmChunk, false);
          llmPartial = llmParsed.partial;
          if (llmParsed.done) sawLlmDone = true;

          for (const llmEvt of llmParsed.events) {
            record.openRouterObservation = { ...record.openRouterObservation, ...observeOpenRouterUsage(llmEvt.usage) };
            const recovered = { text: '', reasoning: '' };
            appendRecoveredEvent(llmEvt, thinkParser, recovered);
            recoveredText += recovered.text;
            recoveredReasoning += recovered.reasoning;
          }
        }
      }

      if (done) {
        if (!shouldBreak) outcome = 'network';
        break;
      }
      if (shouldBreak) break;
    }

    // Terminal completion alone permits finalizing parser buffers.
    if (outcome === 'complete') {
      const flushedLlm = parseEventSource(llmPartial, true);
      for (const llmEvt of flushedLlm.events) {
        record.openRouterObservation = { ...record.openRouterObservation, ...observeOpenRouterUsage(llmEvt.usage) };
        const recovered = { text: '', reasoning: '' };
        appendRecoveredEvent(llmEvt, thinkParser, recovered);
        recoveredText += recovered.text;
        recoveredReasoning += recovered.reasoning;
      }
      const flushedThink = thinkParser.flush();
      recoveredText += flushedThink.content;
      recoveredReasoning += flushedThink.reasoning;
    }
  } catch {
    outcome = signal.aborted ? 'abort' : 'network';
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  await saveProxyCheckpoint(record.requestId, {
    bufferedText: recoveredText,
    bufferedReasoning: recoveredReasoning,
    lastProxyEventId: record.lastProxyEventId ?? 0,
    llmSsePartial: llmPartial,
    thinkTagCheckpoint: thinkParser.checkpoint(),
    generationId: record.generationId,
    llmDone: sawLlmDone,
    openRouterObservation: record.openRouterObservation,
  });
  record.bufferedText = recoveredText;
  record.bufferedReasoning = recoveredReasoning;
  record.llmSsePartial = llmPartial;
  record.thinkTagCheckpoint = thinkParser.checkpoint();
  record.llmDone = sawLlmDone;
  return { text: recoveredText, reasoning: recoveredReasoning, outcome, retry };
}

export async function recoverPending(opts?: { manual?: boolean }) {
  // Prevent concurrent calls (StrictMode double-mount, rapid visibility changes)
  if (recoveryInProgress) {
    debugReport('recovery-hook', {
      label: 'Recovery Hook',
      status: 'done',
      detail: `${formatDebugTime()} recover skipped (already running)`,
    });
    return;
  }
  recoveryInProgress = true;

  const manual = opts?.manual ?? false;
  const debugId = `recovery-${Date.now()}`;
  debugReport(debugId, { label: 'Stream Recovery', status: 'active', detail: 'Checking pending records…' });

  try {
    await recoverPendingInner(manual, debugId);
  } finally {
    // If recovery was cancelled manually (e.g. debug panel ×), the caller
    // already removed the entry — don't re-create it with a debugReport.
    if (!recoveryCancelledManually) {
      debugReport('recovery-hook', {
        label: 'Recovery Hook',
        status: 'done',
        detail: `${formatDebugTime()} recover finished`,
      });
    }
    recoveryCancelledManually = false;
    recoveryInProgress = false;
  }
}

async function recoverPendingInner(manual: boolean, debugId: string) {
  // Wait for store hydration so proxy credentials are available
  const hydrated = await waitForStoreHydration();
  if (!hydrated) {
    debugReport(debugId, { status: 'error', detail: 'Store hydration timeout' });
    showToast('リカバリ前のストア初期化がタイムアウトしました', 'error');
    return;
  }

  // Skip recovery entirely when proxy is disabled
  const { proxyEnabled } = useStore.getState();
  if (!proxyEnabled) {
    debugReport(debugId, { status: 'done', detail: 'Proxy disabled — recovery skipped' });
    if (manual) showToast('プロキシが無効のためリカバリは実行されません', 'info');
    return;
  }

  let records: StreamRecord[];
  try {
    records = await getAllPending();
  } catch {
    debugReport(debugId, { status: 'error', detail: 'Failed to read pending records' });
    showToast('リカバリの準備に失敗しました', 'error');
    return;
  }

  if (records.length === 0) {
    debugReport(debugId, { status: 'done', detail: 'No pending records' });
    if (manual) showToast('リカバリ対象のレコードがありません', 'info');
    return;
  }

  debugReport(debugId, { detail: `Found ${records.length} pending record(s)` });

  // Create an AbortController for this recovery session
  const abort = new AbortController();
  activeRecoveryAbort = abort;

  // Auto-timeout for the entire recovery session
  const timeoutId = setTimeout(() => abort.abort(), PROXY_RECOVERY_STREAM_TIMEOUT_MS);

  const { setChats } = useStore.getState();
  let recoveredCount = 0;
  let failedCount = 0;
  let restoredMessageCount = 0;
  let timedOut = false;
  let cancelled = false;

  try {
    for (const record of records) {
      if (abort.signal.aborted) {
        cancelled = recoveryCancelledManually;
        timedOut = !cancelled;
        break;
      }

      const { requestId, chatIndex, messageIndex, bufferedText } = record;
      debugReport(debugId, {
        detail: `${formatDebugTime()} inspect ${requestId.slice(0, 8)} m${messageIndex}`,
      });
      let restoredThisRecord = false;
      let proxyRecoveredThisRecord = false;
      let proxyOutcome: ProxyRecoveryResult['outcome'] | undefined;

      // Re-read latest state each iteration to avoid overwriting prior recoveries
      const chats = useStore.getState().chats;
      if (!chats) return;

      const chat = findRecoverableChat(chats, chatIndex);
      if (!chat) {
        await deleteRequest(requestId);
        continue;
      }
      if (!hasRecoverableMessage(chat, messageIndex)) {
        await deleteRequest(requestId);
        continue;
      }

      const currentText = getCurrentMessageText(chat.messages[messageIndex]);
      const currentReasoning = chat.messages[messageIndex].content.find((content) => content.type === 'reasoning');
      const currentReasoningText = currentReasoning && 'text' in currentReasoning ? currentReasoning.text : '';
      const generatingSessions = Object.values(useStore.getState().generatingSessions);
      const hasActiveSession = generatingSessions.some(
        (session) => session.chatId === chat.id && session.messageIndex === messageIndex
      );
      const chatHasAnyActiveSession = generatingSessions.some(
        (session) => session.chatId === chat.id
      );

      // Determine if stream is stale (SW probably died)
      // IMPORTANT: check this BEFORE applying buffered text — applying stale
      // text to an actively-streaming message overwrites the streaming content
      // hash and disconnects the live streaming buffer from the React tree.
      const effectiveStatus = resolveRecoveryStatus(record, Date.now(), hasActiveSession);
      debugReport(`recovery-record:${requestId}`, {
        label: 'Recovery Record',
        status: effectiveStatus === 'streaming' ? 'active' : 'done',
        detail: `${formatDebugTime()} status=${effectiveStatus}`,
      });
      if (effectiveStatus === 'streaming') {
        debugReport(`recovery-record:${requestId}`, {
          status: 'done',
          detail: `${formatDebugTime()} still streaming`,
        });
        continue;
      }

      if (abort.signal.aborted) {
        cancelled = recoveryCancelledManually;
        timedOut = !cancelled;
        break;
      }

      // Apply IndexedDB buffered text (fast, local)
      const bestText = bufferedText.length >= currentText.length ? bufferedText : currentText;
      const bestReasoning = (record.bufferedReasoning ?? '').length >= currentReasoningText.length
        ? record.bufferedReasoning ?? ''
        : currentReasoningText;
      if (shouldApplyRecoveredText(currentText, bestText, currentReasoningText, bestReasoning)) {
        debugReport(`recovery-record:${requestId}`, {
          status: 'active',
          detail: `${formatDebugTime()} apply indexeddb len=${bestText.length}`,
        });
        const updatedChats = cloneChatAtIndex(chats, chatIndex);
        const updatedMessages = updatedChats[chatIndex].messages;
        const oldMsg = updatedMessages[messageIndex];
        const newMsg = buildRecoveredMessage(oldMsg, bestText, bestReasoning);
        updatedMessages[messageIndex] = newMsg;
        upsertActivePathMessage(
          updatedChats[chatIndex],
          messageIndex,
          newMsg,
          useStore.getState().contentStore
        );
        setChats(updatedChats);
        restoredThisRecord = true;
      }

      // Second: try proxy recovery for interrupted/failed/streaming-with-proxy streams
      const { proxyEnabled } = useStore.getState();
      if (
        proxyEnabled &&
        (effectiveStatus === 'interrupted' || effectiveStatus === 'failed' || effectiveStatus === 'streaming-with-proxy') &&
        record.proxySessionId
      ) {
        debugReport(debugId, { detail: `Proxy recovery for session ${record.proxySessionId.slice(0, 8)}…` });
        try {
          const proxyResult = await tryProxyRecovery(
            record,
            getCurrentMessageText(
              useStore.getState().chats?.[chatIndex]?.messages[messageIndex]
            ),
            abort.signal
          );
          // Persist and apply parts already read before a cancellation.  The
          // record remains pending, so a later recovery can continue safely.
          if (proxyResult) {
            proxyOutcome = proxyResult.outcome;
            const proxyText = proxyResult.text;
            debugReport(debugId, { detail: `Proxy recovered ${proxyText.length} chars` });
            debugReport(`recovery-record:${requestId}`, {
              status: 'active',
              detail: `${formatDebugTime()} apply proxy len=${proxyText.length}`,
            });
            const latestChats = useStore.getState().chats;
            if (latestChats) {
              const updatedChats = cloneChatAtIndex(latestChats, chatIndex);
              const updatedMessages = updatedChats[chatIndex].messages;
              const oldMsg = updatedMessages[messageIndex];
              const currentText = getCurrentMessageText(oldMsg);
              const currentReasoning = oldMsg.content.find((content) => content.type === 'reasoning');
              const currentReasoningText = currentReasoning && 'text' in currentReasoning ? currentReasoning.text : '';
              // A cache snapshot can predate the window's final flush. Preserve
              // each field independently rather than comparing combined length.
              const mergedText = proxyText.length >= currentText.length ? proxyText : currentText;
              const mergedReasoning = proxyResult.reasoning.length >= currentReasoningText.length
                ? proxyResult.reasoning
                : currentReasoningText;
              const newMsg = buildRecoveredMessage(oldMsg, mergedText, mergedReasoning);
              updatedMessages[messageIndex] = newMsg;
              upsertActivePathMessage(
                updatedChats[chatIndex],
                messageIndex,
                newMsg,
                useStore.getState().contentStore
              );
              setChats(updatedChats);
              recoveredCount++;
              restoredThisRecord = true;
              proxyRecoveredThisRecord = true;
            }
          }
        } catch {
          debugReport(debugId, { detail: 'Proxy recovery failed, using IndexedDB data' });
          failedCount++;
        }
      }

      const latestChat = useStore.getState().chats?.[chatIndex];
      const targetNodeId = latestChat?.branchTree?.activePath?.[messageIndex];
      const observationChat = useStore.getState().chats?.[chatIndex];
      const observationNode = observationChat?.branchTree?.activePath[messageIndex];
      if (observationChat && observationNode && record.openRouterObservation) recordOpenRouterObservation(observationChat.id, observationNode, record.openRouterObservation);
      if (
        record.generationId &&
        latestChat?.config.providerId === 'openrouter' &&
        targetNodeId
      ) {
        useStore.getState().queueVerification(
          buildVerifiedStatsKey(latestChat.id, targetNodeId),
          {
            generationId: record.generationId,
            chatId: latestChat.id,
            targetNodeId,
            nextAttemptAt: Date.now() + OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
          }
        );
      }

      if (restoredThisRecord) {
        restoredMessageCount++;
      }

      // Set stream end status indicator for the recovered message
      if (targetNodeId && restoredThisRecord) {
        const isPartial = proxyOutcome === 'partial' || proxyOutcome === 'network' || proxyOutcome === 'abort' ||
          (!proxyOutcome && (effectiveStatus === 'interrupted' || effectiveStatus === 'failed'));
        if (isPartial) {
          useStreamEndStatusStore.getState().setStatus(targetNodeId, 'recovered_partial');
        } else if (proxyOutcome === 'complete' || proxyRecoveredThisRecord) {
          useStreamEndStatusStore.getState().setStatus(targetNodeId, 'recovered');
        } else {
          // IndexedDB-only recovery that completed successfully
          useStreamEndStatusStore.getState().setStatus(targetNodeId, 'completed');
        }
      }

      // Clear generating sessions for this chat — but only if no other
      // active session is still streaming to the same chat.
      if (!chatHasAnyActiveSession) {
        useStore.getState().removeSessionsForChat(
          useStore.getState().chats?.[chatIndex]?.id ?? ''
        );
      }

      if (proxyOutcome === 'complete') {
        const config = (() => {
          const { proxyEndpoint, proxyAuthToken } = useStore.getState();
          return { endpoint: proxyEndpoint.replace(/\/+$/, ''), authToken: proxyAuthToken || undefined };
        })();
        await sendAck(config, record.proxySessionId!);
        await deleteRequest(requestId);
      } else if (proxyOutcome === 'partial') {
        await markAcknowledged(requestId);
      } else if (proxyOutcome !== 'network' && proxyOutcome !== 'abort') {
        await deleteRequest(requestId);
      }
      debugReport(`recovery-record:${requestId}`, {
        status: 'done',
        detail: `${formatDebugTime()} record ${proxyOutcome === 'complete' ? 'deleted' : 'retained'}`,
      });
    }
  } finally {
    clearTimeout(timeoutId);
    if (activeRecoveryAbort === abort) {
      activeRecoveryAbort = null;
    }
    // Note: recoveryCancelledManually is intentionally NOT reset here.
    // It is read by recoverPending()'s finally block and reset there.
  }

  debugReport(debugId, {
    status: cancelled ? 'done' : 'done',
    detail: cancelled
      ? 'Recovery cancelled'
      : `Processed ${records.length} record(s)`,
  });

  if (restoredMessageCount > 0) {
    const sourceLabel = recoveredCount > 0
      ? ` ${recoveredCount}件はプロキシから追加復元しました。`
      : '';
    showToast(`リカバリ成功: ${restoredMessageCount}件のメッセージを復元しました。${sourceLabel}`.trim(), 'success');
  } else if (manual && !failedCount && !timedOut) {
    showToast('復元できる新しい内容はありませんでした', 'info');
  }

  if (failedCount > 0) {
    showToast(`リカバリ失敗: ${failedCount}件はプロキシから復元できませんでした`, 'error');
  }

  if (timedOut) {
    showToast('リカバリがタイムアウトしました。しばらくしてから再試行してください', 'error');
  }
}
