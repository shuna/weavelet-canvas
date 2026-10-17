import { describe, expect, it } from 'vitest';
import { proxyRecoveryRetry as sharedRetry } from '../../shared/google-sync/proxy';
import { proxyRecoveryRetry } from './proxyRecoveryPolicy';

const bridge = (input: Parameters<typeof proxyRecoveryRetry>[0]) => JSON.parse(sharedRetry(JSON.stringify(input)));

describe('proxy recovery retry policy', () => {
  it('allows three retries for network and cache-miss partial outcomes only', () => {
    for (const attempt of [0, 1, 2]) {
      expect(bridge({ attempt, outcome: 'network' })).toEqual({ retry: true, delayMs: 500 });
      expect(bridge({ attempt, outcome: 'partial', retry: true }).retry).toBe(true);
    }
    expect(bridge({ attempt: 3, outcome: 'network' }).retry).toBe(false);
    expect(bridge({ attempt: 2, outcome: 'partial', retry: false }).retry).toBe(false);
    expect(bridge({ attempt: 2, outcome: 'complete' }).retry).toBe(false);
    expect(bridge({ attempt: 2, outcome: 'abort' }).retry).toBe(false);
  });

  it('clamps Retry-After seconds and accepts the Web millisecond checkpoint', () => {
    expect(bridge({ attempt: 0, outcome: 'network', retryAfter: '0' }).delayMs).toBe(0);
    expect(bridge({ attempt: 0, outcome: 'network', retryAfter: '2.5' }).delayMs).toBe(2500);
    expect(bridge({ attempt: 0, outcome: 'network', retryAfter: '99' }).delayMs).toBe(5000);
    expect(bridge({ attempt: 0, outcome: 'network', retryAfter: '-1' }).delayMs).toBe(0);
    expect(bridge({ attempt: 0, outcome: 'network', retryAfter: 'invalid' }).delayMs).toBe(500);
    expect(bridge({ attempt: 0, outcome: 'network', retryAfterMs: 1200 }).delayMs).toBe(1200);
  });
});
