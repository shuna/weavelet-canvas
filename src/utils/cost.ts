import { getModelCost, isKnownModel } from '@utils/modelLookup';
import type { TotalTokenUsed } from '@type/chat';
import type { ProviderId } from '@type/provider';
import { calculateUsageCostCore } from './costCore';

export type { UsageCostResult } from './costCore';
export { parseTokenKey, buildTokenUsageKey, mergeTotalTokenUsed } from './costCore';
export { countImageInputs } from './chatTitle';

export const calculateUsageCost = (usage: TotalTokenUsed[string] | undefined,
  modelId: string, providerId?: ProviderId) => {
  if (!usage) return calculateUsageCostCore(usage, undefined, false);
  const cost = getModelCost(modelId, providerId);
  return calculateUsageCostCore(usage, cost, cost ? true : isKnownModel(modelId));
};
