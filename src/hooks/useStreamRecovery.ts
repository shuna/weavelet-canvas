import { requestSnapshotFlush } from '@utils/streamingBuffer';
import { recordOpenRouterObservation } from '@utils/openrouterObservation';
import { observeOpenRouterUsage } from '@utils/openrouterControls';
import { useEffect, useRef } from 'react';
import useStore from '@store/store';
import { getAllPending, deleteRequest, saveRecoveryRecord, saveProxyCheckpoint, StreamRecord } from '@utils/streamDb';
import { materializeActivePath } from '@utils/branchUtils';
import { addContent } from '@utils/contentStore';
import { beginAiTask, cancelAiTask, finishAiTask, isAiTaskCurrent, type AiTaskTicket } from './aiTaskLifetime';
import { cloneChatAtIndex } from '@utils/chatShallowClone';
import { register } from '@utils/swBridge';
import {
  fetchProxyRecovery,
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
  resolveRecoveryTarget,
  getCurrentMessageText,
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
let activeRecoveryTicket: AiTaskTicket | null = null;
let recoveryCancelledManually = false;

/** Cancel any in-flight proxy recovery. Called externally for manual stop. */
export function cancelActiveRecovery(silent = false) {
  if (activeRecoveryAbort) {
    recoveryCancelledManually = true;
    if (activeRecoveryTicket) cancelAiTask(activeRecoveryTicket);
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
    return result;
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
    const retryAfterMs = retry !== null && Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1000, 0), 5_000) : undefined;
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
  }, () => !!activeRecoveryTicket && isAiTaskCurrent(activeRecoveryTicket));
  record.bufferedText = recoveredText;
  record.bufferedReasoning = recoveredReasoning;
  record.llmSsePartial = llmPartial;
  record.thinkTagCheckpoint = thinkParser.checkpoint();
  record.llmDone = sawLlmDone;
  return { text: recoveredText, reasoning: recoveredReasoning, outcome, retry };
}

export async function recoverPending(opts?: { manual?: boolean; chatId?: string }) {
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
    await recoverPendingInner(manual, debugId, opts?.chatId);
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

async function recoverPendingInner(manual: boolean, debugId: string, chatId?: string) {
  // Wait for store hydration so proxy credentials are available
  const hydrated = await waitForStoreHydration();
  if (!hydrated) {
    debugReport(debugId, { status: 'error', detail: 'Store hydration timeout' });
    showToast('リカバリ前のストア初期化がタイムアウトしました', 'error');
    return;
  }

  let records: StreamRecord[];
  try {
    records = (await getAllPending()).filter(record => !chatId || record.chatId === chatId);
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

  let recoveredCount = 0;
  let failedCount = 0;
  let partialCount = 0;
  let skippedCount = 0;
  let completedCount = 0;
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

      const { requestId, bufferedText } = record;
      const initial = useStore.getState();
      const target = resolveRecoveryTarget(initial.chats, initial.contentStore, record);
      if (!target) {
        skippedCount++;
        debugReport(`recovery-record:${requestId}`, { label: 'Recovery Record', status: 'done', detail: 'IDs or saved checkpoint do not match; retained' });
        continue;
      }
      const hasActiveSession = Object.values(initial.generatingSessions).some(session => session.chatId === record.chatId && session.targetNodeId === record.nodeId);
      const effectiveStatus = resolveRecoveryStatus(record, Date.now(), hasActiveSession);
      if (effectiveStatus === 'streaming') { skippedCount++; continue; }
      if (record.status === 'streaming') record.status = 'interrupted';

      const recordAbort = new AbortController();
      const abortRecord = () => recordAbort.abort();
      abort.signal.addEventListener('abort', abortRecord, { once: true });
      const ticket = beginAiTask({ kind: 'recovery', requestId, chatId: record.chatId!, nodeId: record.nodeId!, dependencyIds: [], cancel: abortRecord });
      activeRecoveryTicket = ticket;
      let expectedHash = target.node.contentHash;
      let restoredThisRecord = false;
      let proxyRecoveredThisRecord = false;
      const currentTarget = () => {
        if (!isAiTaskCurrent(ticket)) return null;
        const state = useStore.getState();
        if (Object.values(state.generatingSessions).some(session => session.chatId === record.chatId && session.targetNodeId === record.nodeId)) return null;
        return resolveRecoveryTarget(state.chats, state.contentStore, record, expectedHash);
      };
      let proxyOutcome: ProxyRecoveryResult['outcome'] | undefined;
      const applyText = (text: string, reasoning = ''): boolean => {
        const latest = currentTarget();
        if (!latest) return false;
        const currentText = getCurrentMessageText(latest.message);
        const reasoningContent = latest.message.content.find(content => content.type === 'reasoning');
        const currentReasoning = reasoningContent && 'text' in reasoningContent ? reasoningContent.text : '';
        if (!shouldApplyRecoveredText(currentText, text, currentReasoning, reasoning)) return false;
        text = text.length >= currentText.length ? text : currentText;
        reasoning = reasoning.length >= currentReasoning.length ? reasoning : currentReasoning;
        const state = useStore.getState();
        const chats = cloneChatAtIndex(state.chats!, latest.chatIndex);
        const chat = chats[latest.chatIndex];
        const contentStore = Object.fromEntries(Object.entries(state.contentStore).map(([hash, entry]) => [hash, { ...entry }]));
        const message = buildRecoveredMessage(latest.message, text, reasoning);
        expectedHash = addContent(contentStore, message.content);
        chat.branchTree = { ...chat.branchTree!, nodes: { ...chat.branchTree!.nodes, [record.nodeId!]: { ...latest.node, contentHash: expectedHash } } };
        chat.messages = materializeActivePath(chat.branchTree!, contentStore);
        state.invalidateBranchHistory([chat.id]);
        state.applyBranchState(chats, contentStore, { recordHistory: false });
        restoredThisRecord = true;
        return true;
      };
      try {
        applyText(bufferedText, record.bufferedReasoning);
        if (useStore.getState().proxyEnabled && record.proxyComplete !== true && record.proxySessionId) {
          try {
            const latest = currentTarget();
            if (!latest) continue;
            const proxyResult = await tryProxyRecovery(record, getCurrentMessageText(latest.message), recordAbort.signal);
            if (!currentTarget()) continue;
            if (proxyResult) {
              proxyOutcome = proxyResult.outcome;
              if (proxyOutcome === 'network') failedCount++;
              if (proxyOutcome === 'partial') partialCount++;
              record.proxyComplete = proxyOutcome === 'complete';
              if (record.proxyComplete) record.status = 'completed';
              // Keep the proxy result recoverable until the primary snapshot commits.
              await saveRecoveryRecord({ ...record, updatedAt: Date.now() }, () => !!currentTarget());
              if (!currentTarget()) continue;
              if (applyText(proxyResult.text, proxyResult.reasoning)) { recoveredCount++; proxyRecoveredThisRecord = true; }
            }
          } catch {
            debugReport(debugId, { detail: 'Proxy recovery failed, using IndexedDB data' });
            failedCount++;
          }
        }
        const latest = currentTarget();
        if (!latest) continue;
        if (record.openRouterObservation) recordOpenRouterObservation(latest.chat.id, record.nodeId!, record.openRouterObservation);
        if (record.generationId && latest.chat.config.providerId === 'openrouter') {
          useStore.getState().queueVerification(buildVerifiedStatsKey(latest.chat.id, record.nodeId!), {
            generationId: record.generationId, chatId: latest.chat.id, targetNodeId: record.nodeId!,
            nextAttemptAt: Date.now() + OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
          });
        }
        if (record.proxyComplete === true) {
          completedCount++;
          useStreamEndStatusStore.getState().setStatus(record.nodeId!, 'recovered');
        }
        if (restoredThisRecord) {
          await saveRecoveryRecord({ ...record, bufferedText: record.proxySessionId ? record.bufferedText : getCurrentMessageText(latest.message), appliedHash: expectedHash, updatedAt: Date.now() }, () => !!currentTarget());
          requestSnapshotFlush();
          if (!currentTarget()) continue;
          restoredMessageCount++;
          const isPartial = proxyOutcome ? proxyOutcome !== 'complete' : effectiveStatus === 'interrupted' || effectiveStatus === 'failed';
          useStreamEndStatusStore.getState().setStatus(record.nodeId!, isPartial ? 'recovered_partial' : proxyRecoveredThisRecord ? 'recovered' : 'completed');
          // Bootstrap acknowledges appliedHash only after the primary snapshot commits.
        } else {
          await saveRecoveryRecord({ ...record, appliedHash: expectedHash, updatedAt: Date.now() }, () => !!currentTarget());
          requestSnapshotFlush();
        }
      } finally {
        if (activeRecoveryTicket === ticket) activeRecoveryTicket = null;
        finishAiTask(ticket);
        abort.signal.removeEventListener('abort', abortRecord);
      }

    }
  } finally {
    cancelled = recoveryCancelledManually;
    timedOut = abort.signal.aborted && !cancelled;
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

  if (cancelled) return;

  if (restoredMessageCount > 0) {
    const sourceLabel = recoveredCount > 0
      ? ` ${recoveredCount}件はプロキシから追加復元しました。`
      : '';
    const incomplete = failedCount > 0 || partialCount > 0 || timedOut;
    showToast(`リカバリ${incomplete ? '途中' : '成功'}: ${restoredMessageCount}件のメッセージを復元しました。${sourceLabel}`.trim(), incomplete ? 'warning' : 'success');
  } else if (manual && completedCount > 0) {
    showToast(`リカバリ成功: ${completedCount}件の応答の受信完了を確認しました`, 'success');
  } else if (manual && !failedCount && !partialCount && !timedOut && !skippedCount) {
    showToast('復元できる新しい内容はありませんでした', 'info');
  }

  if (failedCount > 0) {
    showToast(`リカバリ失敗: ${failedCount}件はプロキシから復元できませんでした`, 'error');
  }

  if (partialCount > 0) {
    showToast(`リカバリ未完了: ${partialCount}件の記録を保持しています。しばらくしてから再試行してください`, 'warning');
  }

  if (manual && skippedCount > 0) {
    showToast(`リカバリ保留: ${skippedCount}件は生成中、または復元先を安全に確認できませんでした。記録は保持しています`, 'info');
  }

  if (timedOut) {
    showToast('リカバリがタイムアウトしました。しばらくしてから再試行してください', 'error');
  }
}
