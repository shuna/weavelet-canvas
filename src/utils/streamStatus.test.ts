import { expect, it } from 'vitest';
import { PENDING_RETENTION_MS, streamStatus, updateStreamState } from './streamStatus';

const call = (input: object) => JSON.parse(streamStatus(JSON.stringify(input)));

it('keeps request identity and future attributes until a new request starts', () => {
  const previous = { reason: 'future_reason', requestId: 'old', proxy: true, createdAt: 10, future: { value: 1 } } as any;
  expect(updateStreamState(previous, 'error', undefined, 20)).toEqual({ ...previous, reason: 'error' });
  expect(call({ operation: 'update', previous, reason: 'streaming', now: 20 })).toEqual({ reason: 'streaming', createdAt: 20 });
  expect(call({ operation: 'update', previous, reason: 'recovered', request: { requestId: 'new', proxy: false, createdAt: 30 }, now: 40 }))
    .toEqual({ ...previous, reason: 'recovered', requestId: 'new', proxy: false, createdAt: 30 });
});

it('describes known saved reasons, retention boundary, and hides future reasons', () => {
  const saved = { reason: 'error', requestId: 'r', proxy: true, createdAt: 10 };
  expect(call({ operation: 'describe', saved, transient: 'completed', proxyEnabled: true, now: 10 + PENDING_RETENTION_MS }))
    .toEqual({ reason: 'error', text: '送信エラー', tone: 'error', incomplete: true, expired: false, canRecover: true, requestId: 'r' });
  expect(call({ operation: 'describe', saved, proxyEnabled: true, now: 11 + PENDING_RETENTION_MS }))
    .toMatchObject({ expired: true, canRecover: false });
  expect(call({ operation: 'describe', saved: { ...saved, reason: 'future_reason' }, proxyEnabled: true, now: 10 })).toBeNull();
});

it.each([
  ['streaming', '応答が中断されました', 'warning', true],
  ['completed', '完了', 'success', false],
  ['max_tokens', '最大トークン数に到達（応答が途切れている可能性があります）', 'warning', false],
  ['interrupted', '中断されました', 'neutral', true],
  ['error', '送信エラー', 'error', true],
  ['recovered', 'プロキシから復元済み', 'info', false],
  ['recovered_partial', 'プロキシから部分復元（応答が不完全です）', 'warning', true],
])('describes %s', (reason, text, tone, incomplete) => {
  expect(call({ operation: 'describe', transient: reason, proxyEnabled: false, now: 0 }))
    .toEqual({ reason, text, tone, incomplete, expired: false, canRecover: false });
});

it('classifies endings and recovery outcomes with the current Web precedence', () => {
  expect(call({ operation: 'endReason', failed: true, completed: false })).toBe('error');
  expect(call({ operation: 'endReason', failed: false, completed: false, finishReason: 'length' })).toBe('interrupted');
  expect(call({ operation: 'endReason', failed: false, completed: true, finishReason: 'length' })).toBe('max_tokens');
  expect(call({ operation: 'endReason', failed: false, completed: true, finishReason: 'stop' })).toBe('completed');
  expect(call({ operation: 'recoveryReason', proxyComplete: true, proxyOutcome: 'network', effectiveStatus: 'failed' })).toBe('recovered');
  expect(call({ operation: 'recoveryReason', proxyComplete: false, proxyOutcome: 'network', effectiveStatus: 'failed' })).toBe('error');
  expect(call({ operation: 'recoveryReason', proxyComplete: false, proxyOutcome: 'abort', effectiveStatus: 'failed' })).toBe('interrupted');
  expect(call({ operation: 'recoveryReason', proxyComplete: false, proxyOutcome: 'partial', effectiveStatus: 'completed' })).toBe('recovered_partial');
  expect(call({ operation: 'recoveryReason', proxyComplete: false, effectiveStatus: 'completed' })).toBe('completed');
});
