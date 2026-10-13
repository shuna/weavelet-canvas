import type { ProviderId } from '@type/provider';
import { findCachedModel, findFavorite, findProviderCustomModel, type ReasoningModelState } from './modelReasoning';

export interface ModelCostEntry {
  prompt: { price: number | null; unit: number };
  completion: { price: number | null; unit: number };
  image?: { price: number | null; unit: number };
}

export function getModelCostCore(state: ReasoningModelState, modelId: string,
  providerId?: ProviderId, modelSource?: 'remote' | 'local'): ModelCostEntry | undefined {
  if (modelSource === 'local') return undefined;
  const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
  if (custom) return {
    prompt: { price: custom.promptPrice ?? null, unit: 1_000_000 },
    completion: { price: custom.completionPrice ?? null, unit: 1_000_000 },
    image: { price: custom.imagePrice ?? null, unit: 1 },
  };
  const favorite = findFavorite(state.favoriteModels ?? [], modelId, providerId);
  if (favorite) return {
    prompt: { price: favorite.promptPrice ?? null, unit: 1_000_000 },
    completion: { price: favorite.completionPrice ?? null, unit: 1_000_000 },
    image: { price: favorite.imagePrice ?? null, unit: 1 },
  };
  const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
  if (cached) return {
    prompt: { price: cached.promptPrice ?? null, unit: 1_000_000 },
    completion: { price: cached.completionPrice ?? null, unit: 1_000_000 },
  };
}

export function isKnownModelCore(state: ReasoningModelState, modelId: string): boolean {
  if (Object.values(state.providerCustomModels ?? {}).some(models => models?.some(model => model.modelId === modelId))) return true;
  if (state.favoriteModels?.some(model => model.modelId === modelId)) return true;
  return Object.values(state.providerModelCache ?? {}).some(models => models?.some(model => model.id === modelId));
}
