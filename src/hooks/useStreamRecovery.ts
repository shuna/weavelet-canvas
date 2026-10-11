import { requestSnapshotFlush } from '@utils/streamingBuffer';
import { recordOpenRouterObservation } from '@utils/openrouterObservation';
import { observeOpenRouterUsage } from '@utils/openrouterControls';
import { useEffect, useRef } from 'react';
import useStore from '@store/store';
import { getAllPending, deleteRequest, saveRequest, StreamRecord } from '@utils/streamDb';
import { materializeActivePath } from '@utils/branchUtils';
import { addContent } from '@utils/contentStore';
import { beginAiTask, finishAiTask, isAiTaskCurrent } from './aiTaskLifetime';
import { cloneChatAtIndex } from '@utils/chatShallowClone';
import { register } from '@utils/swBridge';
import {
  recoverFromProxy,
  parseProxySse,
  type ProxyConfig,
} from '@utils/proxyClient';
import { parseEventSource } from '@api/helper';
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
const PROXY_RECOVERY_RETRY_DELAY_MS = 2000;

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
async function tryProxyRecovery(
  record: StreamRecord,
  currentText: string,
  signal: AbortSignal
): Promise<string | null> {
  const { proxyEnabled, proxyEndpoint, proxyAuthToken } = useStore.getState();
  if (!proxyEnabled || !proxyEndpoint || !record.proxySessionId) return null;

  const config: ProxyConfig = {
    endpoint: proxyEndpoint.replace(/\/+$/, ''),
    authToken: proxyAuthToken || undefined,
  };

  let bestText: string | null = null;

  for (let attempt = 0; attempt <= PROXY_RECOVERY_MAX_RETRIES; attempt++) {
    if (signal.aborted) break;

    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, PROXY_RECOVERY_RETRY_DELAY_MS));
    }

    if (signal.aborted) break;

    const result = await readProxyRecoveryStream(config, record, signal);
    if (!result) break;

    if (result.text.length > (bestText?.length ?? 0)) {
      bestText = result.text;
    }

    // If the stream completed or errored, no point retrying
    if (!result.interrupted) break;
  }

  return bestText && bestText.length > currentText.length ? bestText : null;
}

async function readProxyRecoveryStream(
  config: ProxyConfig,
  record: StreamRecord,
  signal: AbortSignal
): Promise<{ text: string; interrupted: boolean } | null> {
  const stream = await recoverFromProxy(
    config,
    record.proxySessionId!,
    record.lastProxyEventId ?? 0,
    signal
  );
  if (!stream) return null;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let partial = '';
  let llmPartial = '';
  let recoveredText = record.bufferedText;
  let interrupted = false;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) {
        interrupted = true;
        break;
      }

      const { done, value } = await reader.read();
      const chunk = partial + decoder.decode(done ? undefined : value, { stream: !done });
      const proxySse = parseProxySse(chunk, done);
      partial = proxySse.partial;

      let shouldBreak = false;
      for (const evt of proxySse.events) {
        if (evt.eventType === 'interrupted') {
          interrupted = true;
          shouldBreak = true;
          break;
        }
        if (evt.eventType === 'done' || evt.eventType === 'error') {
          if (evt.meta?.openRouterObservation) record.openRouterObservation = { ...record.openRouterObservation, ...evt.meta.openRouterObservation };
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

          for (const llmEvt of llmParsed.events) {
            record.openRouterObservation = { ...record.openRouterObservation, ...observeOpenRouterUsage(llmEvt.usage) };
            const content = llmEvt.choices?.[0]?.delta?.content;
            if (content) recoveredText += content;
          }
        }
      }

      if (shouldBreak || done) break;
    }

    // Flush remaining LLM partial
    if (llmPartial) {
      const flushed = parseEventSource(llmPartial, true);
      for (const llmEvt of flushed.events) {
        record.openRouterObservation = { ...record.openRouterObservation, ...observeOpenRouterUsage(llmEvt.usage) };
        const content = llmEvt.choices?.[0]?.delta?.content;
        if (content) recoveredText += content;
      }
    }
  } catch {
    // Network error during recovery — use what we have
  } finally {
    reader.cancel().catch(() => {});
  }

  return { text: recoveredText, interrupted };
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

      const { requestId, bufferedText } = record;
      const initial = useStore.getState();
      const target = resolveRecoveryTarget(initial.chats, initial.contentStore, record);
      if (!target) {
        debugReport(`recovery-record:${requestId}`, { label: 'Recovery Record', status: 'done', detail: 'IDs or saved checkpoint do not match; retained' });
        continue;
      }
      const hasActiveSession = Object.values(initial.generatingSessions).some(session => session.chatId === record.chatId && session.targetNodeId === record.nodeId);
      const effectiveStatus = resolveRecoveryStatus(record, Date.now(), hasActiveSession);
      if (effectiveStatus === 'streaming') continue;

      const recordAbort = new AbortController();
      const abortRecord = () => recordAbort.abort();
      abort.signal.addEventListener('abort', abortRecord, { once: true });
      const ticket = beginAiTask({ kind: 'recovery', requestId, chatId: record.chatId!, nodeId: record.nodeId!, dependencyIds: [], cancel: abortRecord });
      let expectedHash = record.checkpointHash!;
      let restoredThisRecord = false;
      let proxyRecoveredThisRecord = false;
      const currentTarget = () => {
        if (recordAbort.signal.aborted || !isAiTaskCurrent(ticket)) return null;
        const state = useStore.getState();
        if (Object.values(state.generatingSessions).some(session => session.chatId === record.chatId && session.targetNodeId === record.nodeId)) return null;
        return resolveRecoveryTarget(state.chats, state.contentStore, record, expectedHash);
      };
      const applyText = (text: string): boolean => {
        const latest = currentTarget();
        if (!latest || !shouldApplyRecoveredText(getCurrentMessageText(latest.message), text)) return false;
        const state = useStore.getState();
        const chats = cloneChatAtIndex(state.chats!, latest.chatIndex);
        const chat = chats[latest.chatIndex];
        const contentStore = Object.fromEntries(Object.entries(state.contentStore).map(([hash, entry]) => [hash, { ...entry }]));
        const message = buildRecoveredMessage(latest.message, text);
        expectedHash = addContent(contentStore, message.content);
        chat.branchTree!.nodes[record.nodeId!] = { ...latest.node, contentHash: expectedHash };
        chat.messages = materializeActivePath(chat.branchTree!, contentStore);
        state.invalidateBranchHistory([chat.id]);
        state.applyBranchState(chats, contentStore, { recordHistory: false });
        restoredThisRecord = true;
        return true;
      };
      try {
        applyText(bufferedText);
        if (useStore.getState().proxyEnabled && effectiveStatus !== 'completed' && record.proxySessionId) {
          try {
            const latest = currentTarget();
            if (!latest) continue;
            const proxyText = await tryProxyRecovery(record, getCurrentMessageText(latest.message), recordAbort.signal);
            if (!currentTarget()) continue;
            if (proxyText) {
              // Keep the proxy result recoverable until the primary snapshot commits.
              await saveRequest({ ...record, bufferedText: proxyText, updatedAt: Date.now() });
              if (!currentTarget()) continue;
              if (applyText(proxyText)) { recoveredCount++; proxyRecoveredThisRecord = true; }
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
        if (restoredThisRecord) {
          await saveRequest({ ...record, bufferedText: getCurrentMessageText(latest.message), appliedHash: expectedHash, updatedAt: Date.now() });
          requestSnapshotFlush();
          if (!currentTarget()) continue;
          restoredMessageCount++;
          const isPartial = effectiveStatus === 'interrupted' || effectiveStatus === 'failed';
          useStreamEndStatusStore.getState().setStatus(record.nodeId!, isPartial ? 'recovered_partial' : proxyRecoveredThisRecord ? 'recovered' : 'completed');
          // Bootstrap acknowledges appliedHash only after the primary snapshot commits.
        } else if (latest.node.contentHash === record.checkpointHash) {
          await saveRequest({ ...record, appliedHash: expectedHash, updatedAt: Date.now() });
          requestSnapshotFlush();
        }
      } finally {
        finishAiTask(ticket);
        abort.signal.removeEventListener('abort', abortRecord);
      }

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
