import type { TotalTokenUsed } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';
import { getModelCostCore, isKnownModelCore } from '../../src/utils/modelCostCore';
import { calculateUsageCostCore, mergeTotalTokenUsed, parseTokenKey, summarizeUsageCosts } from '../../src/utils/costCore';

export function usageCost(json: string): string {
  const input = JSON.parse(json) as { state: ReasoningModelState; totalTokenUsed: TotalTokenUsed;
    liveTokenUsed?: TotalTokenUsed; liveTokenUsages?: TotalTokenUsed[] };
  const live = input.liveTokenUsages?.reduce(mergeTotalTokenUsed, input.liveTokenUsed ?? {}) ?? input.liveTokenUsed;
  const totals = live
    ? mergeTotalTokenUsed(input.totalTokenUsed ?? {}, live) : input.totalTokenUsed ?? {};
  const rows = Object.entries(totals).map(([key, usage]) => {
    const { modelId, providerId } = parseTokenKey(key);
    const costEntry = getModelCostCore(input.state ?? {}, modelId, providerId);
    const result = calculateUsageCostCore(usage, costEntry,
      costEntry ? true : isKnownModelCore(input.state ?? {}, modelId));
    return { key, label: key.replace(':::', ' / '), ...result,
      ...(result.kind === 'known' && !result.isFree ? { display: result.cost.toPrecision(3) } : {}) };
  });
  return JSON.stringify({ rows, total: summarizeUsageCosts(rows) });
}
