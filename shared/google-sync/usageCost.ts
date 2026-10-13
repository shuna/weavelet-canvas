import type { TotalTokenUsed } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';
import { getModelCostCore, isKnownModelCore } from '../../src/utils/modelCostCore';
import { calculateUsageCostCore, mergeTotalTokenUsed, parseTokenKey } from '../../src/utils/costCore';

export function usageCost(json: string): string {
  const input = JSON.parse(json) as { state: ReasoningModelState; totalTokenUsed: TotalTokenUsed;
    liveTokenUsed?: TotalTokenUsed };
  const totals = input.liveTokenUsed
    ? mergeTotalTokenUsed(input.totalTokenUsed ?? {}, input.liveTokenUsed) : input.totalTokenUsed ?? {};
  const rows = Object.entries(totals).map(([key, usage]) => {
    const { modelId, providerId } = parseTokenKey(key);
    const costEntry = getModelCostCore(input.state ?? {}, modelId, providerId);
    const result = calculateUsageCostCore(usage, costEntry,
      costEntry ? true : isKnownModelCore(input.state ?? {}, modelId));
    return { key, label: key.replace(':::', ' / '), ...result,
      ...(result.kind === 'known' && !result.isFree ? { display: result.cost.toPrecision(3) } : {}) };
  });
  const total = rows.some(row => row.kind === 'unknown') ? { kind: 'unknown' as const } : (() => {
    const cost = rows.reduce((sum, row) => sum + (row.kind === 'known' ? row.cost : 0), 0);
    const isFree = rows.length > 0 && rows.every(row => row.kind === 'known' && row.isFree);
    return { kind: 'known' as const, cost, isFree, ...(isFree ? {} : { display: cost.toPrecision(3) }) };
  })();
  return JSON.stringify({ rows, total });
}
