import type { BranchNode, StreamEndReason } from '@type/chat';

type StreamState = NonNullable<BranchNode['streamState']>;
type Request = { requestId: string; proxy: boolean; createdAt?: number };

export const PENDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const labels: Record<StreamEndReason, { text: string; tone: string }> = {
  streaming: { text: '応答が中断されました', tone: 'warning' },
  completed: { text: '完了', tone: 'success' },
  max_tokens: { text: '最大トークン数に到達（応答が途切れている可能性があります）', tone: 'warning' },
  interrupted: { text: '中断されました', tone: 'neutral' },
  error: { text: '送信エラー', tone: 'error' },
  recovered: { text: 'プロキシから復元済み', tone: 'info' },
  recovered_partial: { text: 'プロキシから部分復元（応答が不完全です）', tone: 'warning' },
};

export function updateStreamState(previous: StreamState | undefined, reason: StreamEndReason, request: Request | undefined, now: number): StreamState {
  const retained = reason === 'streaming' && !request ? undefined : previous;
  return { ...retained, ...request, reason, createdAt: request?.createdAt ?? retained?.createdAt ?? now };
}

export function describeStreamStatus(saved: StreamState | undefined, transient: StreamEndReason | undefined, proxyEnabled: boolean, now: number) {
  const reason = saved?.reason ?? transient;
  if (!reason || !Object.hasOwn(labels, reason)) return null;
  const incomplete = reason === 'streaming' || reason === 'interrupted' || reason === 'error' || reason === 'recovered_partial';
  const expired = !!saved && now - saved.createdAt > PENDING_RETENTION_MS;
  return {
    reason, ...labels[reason], incomplete, expired,
    canRecover: !!(incomplete && saved?.proxy && saved.requestId && proxyEnabled && !expired),
    ...(saved?.requestId === undefined ? {} : { requestId: saved.requestId }),
  };
}

export function streamEndReason(failed: boolean, completed: boolean, finishReason?: string): StreamEndReason {
  return failed ? 'error' : !completed ? 'interrupted' : finishReason === 'length' ? 'max_tokens' : 'completed';
}

export function streamRecoveryReason(proxyComplete: boolean, proxyOutcome: 'complete' | 'network' | 'abort' | 'partial' | undefined, effectiveStatus: 'completed' | 'interrupted' | 'failed' | 'streaming' | 'streaming-with-proxy'): StreamEndReason {
  return proxyComplete ? 'recovered'
    : proxyOutcome === 'network' ? 'error' : proxyOutcome === 'abort' ? 'interrupted'
    : proxyOutcome === 'partial' || effectiveStatus === 'interrupted' || effectiveStatus === 'failed' ? 'recovered_partial' : 'completed';
}

export function streamStatus(json: string): string {
  const input = JSON.parse(json);
  switch (input.operation) {
    case 'update': return JSON.stringify(updateStreamState(input.previous, input.reason, input.request, input.now));
    case 'describe': return JSON.stringify(describeStreamStatus(input.saved, input.transient, input.proxyEnabled, input.now));
    case 'endReason': return JSON.stringify(streamEndReason(input.failed, input.completed, input.finishReason));
    case 'recoveryReason': return JSON.stringify(streamRecoveryReason(input.proxyComplete, input.proxyOutcome, input.effectiveStatus));
    default: throw new Error('Unknown stream status operation');
  }
}
