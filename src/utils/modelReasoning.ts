import type { CustomProviderModel, ProviderId, FavoriteModel, ProviderModel } from '@type/provider';
import type { ConfigInterface } from '@type/chat';
import { isReasoningModel } from '@api/providerModels';
export type ReasoningModelState = {
  providerCustomModels?: Partial<Record<ProviderId, CustomProviderModel[]>>;
  favoriteModels?: FavoriteModel[];
  providerModelCache?: Partial<Record<ProviderId, ProviderModel[]>>;
};
const inferMandatoryReasoning = (
  modelId: string,
  providerId?: ProviderId
): boolean =>
  providerId === 'openrouter' &&
  /claude-opus-5[.-]5(?:$|:)/.test(modelId.toLowerCase());

export function findProviderCustomModel(
  providerCustomModels: Partial<Record<ProviderId, CustomProviderModel[]>> | undefined,
  modelId: string,
  providerId?: ProviderId
): CustomProviderModel | undefined {
  if (!providerCustomModels) return undefined;
  if (providerId) {
    return providerCustomModels[providerId]?.find((m) => m.modelId === modelId);
  }
  for (const models of Object.values(providerCustomModels)) {
    if (!models) continue;
    const found = models.find((m) => m.modelId === modelId);
    if (found) return found;
  }
  return undefined;
}

export function findFavorite(
  favorites: FavoriteModel[],
  modelId: string,
  providerId?: ProviderId
): FavoriteModel | undefined {
  if (providerId) {
    return favorites.find(
      (f) => f.modelId === modelId && f.providerId === providerId
    );
  }
  return favorites.find((f) => f.modelId === modelId);
}

export function findCachedModel(
  cache: Partial<Record<ProviderId, ProviderModel[]>>,
  modelId: string,
  providerId?: ProviderId
): ProviderModel | undefined {
  if (providerId && cache[providerId]) {
    return cache[providerId]!.find((m) => m.id === modelId);
  }
  for (const models of Object.values(cache)) {
    if (!models) continue;
    const found = models.find((m) => m.id === modelId);
    if (found) return found;
  }
  return undefined;
}

export function modelSupportsReasoning(state: ReasoningModelState, modelId: string, providerId?: ProviderId, modelSource?: 'remote' | 'local'): boolean {
  if (modelSource === 'local') return false;
  const inferred = isReasoningModel(modelId);
  const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
  if (custom?.supportsReasoning != null) return custom.supportsReasoning;
  const fav = findFavorite(state.favoriteModels ?? [], modelId, providerId);
  if (fav?.supportsReasoning != null) return fav.supportsReasoning || inferred;
  const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
  if (cached?.supportsReasoning != null) return cached.supportsReasoning || inferred;
  return inferred;
}
export function modelRequiresReasoning(state: ReasoningModelState, modelId: string, providerId?: ProviderId): boolean {
  const favorite = findFavorite(state.favoriteModels ?? [], modelId, providerId);
  const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
  return favorite?.reasoningMandatory ?? cached?.reasoningMandatory ?? inferMandatoryReasoning(modelId, providerId);
}
export function buildReasoningCapabilities(config: ConfigInterface, supportsReasoning: boolean, requiresReasoning: () => boolean) {
  return { supportsReasoning, requiresReasoning: !!(supportsReasoning || config.force_reasoning) &&
    config.providerId === 'openrouter' && config.reasoning_effort === 'none' && requiresReasoning() };
}
export function getRequestReasoningCapabilities(config: ConfigInterface, state: ReasoningModelState) {
  return buildReasoningCapabilities(config, modelSupportsReasoning(state, config.model, config.providerId),
    () => modelRequiresReasoning(state, config.model, config.providerId));
}
