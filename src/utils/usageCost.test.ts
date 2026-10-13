import { describe, expect, it } from 'vitest';
import { usageCost } from '../../shared/google-sync/usageCost';

const report = (input: object) => JSON.parse(usageCost(JSON.stringify(input)));
const usage = { promptTokens: 1_000_000, completionTokens: 0, imageTokens: 0 };

describe('shared usage cost report', () => {
  it('uses custom, favorite, then cached pricing and includes live usage without modifying persisted totals', () => {
    const totalTokenUsed = { 'custom:::openrouter': usage, 'favorite:::openrouter': usage, 'cached:::openrouter': usage };
    const state = {
      providerCustomModels: { openrouter: [{ modelId: 'custom', providerId: 'openrouter', promptPrice: 2, completionPrice: 0, imagePrice: 0 }] },
      favoriteModels: [{ modelId: 'custom', providerId: 'openrouter', promptPrice: 99 },
        { modelId: 'favorite', providerId: 'openrouter', promptPrice: 3, completionPrice: 0, imagePrice: 0 }],
      providerModelCache: { openrouter: [{ id: 'custom', promptPrice: 88 }, { id: 'favorite', promptPrice: 77 },
        { id: 'cached', promptPrice: 4, completionPrice: 0 }] },
    };
    const result = report({ state, totalTokenUsed, liveTokenUsed: { 'cached:::openrouter': usage } });
    expect(result.rows.map((row: { cost: number; display: string }) => [row.cost, row.display]))
      .toEqual([[2, '2.00'], [3, '3.00'], [8, '8.00']]);
    expect(result.total).toEqual({ kind: 'known', cost: 13, isFree: false, display: '13.0' });
    expect(totalTokenUsed['cached:::openrouter'].promptTokens).toBe(1_000_000);
  });

  it('distinguishes unregistered and missing pricing and treats only nonempty free totals as free', () => {
    const state = { favoriteModels: [{ modelId: 'unpriced', providerId: 'openai' },
      { modelId: 'free', providerId: 'openai', promptPrice: 0, completionPrice: 0, imagePrice: 0 }] };
    const mixed = report({ state, totalTokenUsed: { 'unpriced:::openai': usage, unknown: usage } });
    expect(mixed.rows.map((row: { reason: string }) => row.reason)).toEqual(['no-pricing-data', 'model-not-registered']);
    expect(mixed.total).toEqual({ kind: 'unknown' });
    expect(report({ state, totalTokenUsed: { 'free:::openai': usage } }).total)
      .toEqual({ kind: 'known', cost: 0, isFree: true });
    expect(report({ state, totalTokenUsed: {} }).total)
      .toEqual({ kind: 'known', cost: 0, isFree: false, display: '0.00' });
  });
});
