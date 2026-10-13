import type { TotalTokenUsed } from '@type/chat';
import type { ProviderId } from '@type/provider';
import type { ModelCostEntry } from './modelCostCore';

export type UsageCostResult =
  | { kind: 'known'; cost: number; isFree: boolean }
  | { kind: 'unknown'; reason: 'model-not-registered' | 'no-pricing-data' };

export const parseTokenKey = (key: string): { modelId: string; providerId?: ProviderId } => {
  const sep = key.indexOf(':::');
  return sep >= 0 ? { modelId: key.slice(0, sep), providerId: key.slice(sep + 3) as ProviderId } : { modelId: key };
};
export const buildTokenUsageKey = (modelId: string, providerId?: ProviderId): string =>
  providerId ? `${modelId}:::${providerId}` : modelId;

export const mergeTotalTokenUsed = (base: TotalTokenUsed, increment: TotalTokenUsed): TotalTokenUsed => {
  const merged: TotalTokenUsed = { ...base };
  Object.entries(increment).forEach(([key, usage]) => {
    if (!usage) return;
    const existing = merged[key] ?? { promptTokens: 0, completionTokens: 0, imageTokens: 0 };
    merged[key] = {
      promptTokens: existing.promptTokens + usage.promptTokens,
      completionTokens: existing.completionTokens + usage.completionTokens,
      imageTokens: existing.imageTokens + usage.imageTokens,
    };
  });
  return merged;
};

const resolveUnitCost = (priceEntry: ModelCostEntry['prompt'] | ModelCostEntry['image'] | undefined,
  usage: number): number | null => {
  if (!priceEntry) return usage === 0 ? 0 : null;
  if (priceEntry.price == null) return usage === 0 ? 0 : null;
  return (priceEntry.price / priceEntry.unit) * usage;
};

export const calculateUsageCostCore = (usage: TotalTokenUsed[string] | undefined,
  costEntry: ModelCostEntry | undefined, knownModel: boolean): UsageCostResult => {
  if (!usage) return { kind: 'known', cost: 0, isFree: true };
  if (!costEntry) return { kind: 'unknown', reason: knownModel ? 'no-pricing-data' : 'model-not-registered' };
  const promptCost = resolveUnitCost(costEntry.prompt, usage.promptTokens);
  const completionCost = resolveUnitCost(costEntry.completion, usage.completionTokens);
  const imageCost = resolveUnitCost(costEntry.image, usage.imageTokens);
  if (promptCost == null || completionCost == null || imageCost == null) return { kind: 'unknown', reason: 'no-pricing-data' };
  return { kind: 'known', cost: promptCost + completionCost + imageCost,
    isFree: (costEntry.prompt.price ?? 0) === 0 && (costEntry.completion.price ?? 0) === 0
      && (costEntry.image?.price ?? 0) === 0 };
};

export const summarizeUsageCosts = (rows: UsageCostResult[]) => {
  if (rows.some(row => row.kind === 'unknown')) return { kind: 'unknown' as const };
  const cost = rows.reduce((sum, row) => sum + (row.kind === 'known' ? row.cost : 0), 0);
  const isFree = rows.length > 0 && rows.every(row => row.kind === 'known' && row.isFree);
  return { kind: 'known' as const, cost, isFree, ...(isFree ? {} : { display: cost.toPrecision(3) }) };
};
