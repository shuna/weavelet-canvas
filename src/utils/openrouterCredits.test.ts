import { describe, expect, it } from 'vitest';
import { displayOpenRouterCredits, parseOpenRouterCredits, shouldFetchOpenRouterCredits } from './openrouterCredits';
import { openRouterCredits } from '../../shared/google-sync/openrouterCredits';

const bridge = (input: unknown) => JSON.parse(openRouterCredits(JSON.stringify(input)));

describe('OpenRouter credits shared policy', () => {
  it('fetches stale balances on open and respects in-flight and three-second cooldown for all reasons', () => {
    const base = { now: 400_000, lastFetch: 390_000, inFlight: false };
    expect(shouldFetchOpenRouterCredits({ ...base, reason: 'open', fetchedAt: 100_000 })).toBe(false);
    expect(bridge({ operation: 'policy', ...base, reason: 'open', fetchedAt: 99_999 })).toEqual({ fetch: true });
    expect(bridge({ operation: 'policy', ...base, reason: 'open' })).toEqual({ fetch: true });
    expect(bridge({ operation: 'policy', ...base, reason: 'completed', fetchedAt: 400_000 })).toEqual({ fetch: true });
    expect(bridge({ operation: 'policy', ...base, reason: 'manual', inFlight: true })).toEqual({ fetch: false });
    expect(bridge({ operation: 'policy', ...base, reason: 'manual', lastFetch: 397_001 })).toEqual({ fetch: false });
  });

  it('shares request, validated response, and clamped currency display without credentials', () => {
    expect(bridge({ operation: 'request' })).toEqual({ endpoint: 'https://openrouter.ai/api/v1/credits',
      authentication: { header: 'Authorization', scheme: 'Bearer' } });
    const payload = { data: { total_credits: 1, total_usage: 2 } };
    expect(parseOpenRouterCredits(payload)).toEqual({ totalCredits: 1, totalUsage: 2 });
    expect(bridge({ operation: 'parse', payload })).toEqual({ balance: { totalCredits: 1, totalUsage: 2 } });
    expect(displayOpenRouterCredits({ totalCredits: 1, totalUsage: 2 })).toBe('$0.00');
    expect(bridge({ operation: 'display', balance: { totalCredits: 1.4, totalUsage: 0.2, fetchedAt: 1 } })).toEqual({ display: '$1.20' });
    expect(bridge({ operation: 'display', balance: { totalCredits: 'invalid', totalUsage: 0 } })).toEqual({ display: null });
    for (const invalid of [{ data: { total_credits: '1', total_usage: 0 } },
      { data: { total_credits: Infinity, total_usage: 0 } }, { data: null }]) {
      expect(parseOpenRouterCredits(invalid)).toBeNull();
    }
  });
});
