import type { ProviderId } from '@type/provider';
import { findProviderCustomModel, findFavorite, findCachedModel, type ReasoningModelState } from './modelReasoning';
import { UNKNOWN_MODEL_CONTEXT_LENGTH, getMaxCompletionTokensForContext } from './tokenBudget';
import { defaultUserMaxToken } from '@constants/chatDefaults';

export function remoteModelContextInfo(state: ReasoningModelState, modelId: string, providerId?: ProviderId) {

  const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
  if (custom?.contextLength) return { contextLength: custom.contextLength, isFallback: false };

  const fav = findFavorite(state.favoriteModels ?? [], modelId, providerId);
  if (fav?.contextLength) return { contextLength: fav.contextLength, isFallback: false };

  const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
  if (cached?.contextLength) return { contextLength: cached.contextLength, isFallback: false };

  return { contextLength: UNKNOWN_MODEL_CONTEXT_LENGTH, isFallback: true };
}

export function remoteModelStreamSupported(state: ReasoningModelState, modelId: string, providerId?: ProviderId): boolean {

  const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
  if (custom?.streamSupport != null) return custom.streamSupport;

  const fav = findFavorite(state.favoriteModels ?? [], modelId, providerId);
  if (fav?.streamSupport != null) return fav.streamSupport;

  const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
  if (cached?.streamSupport != null) return cached.streamSupport;

  return true;
}

export function remoteModelDefaultMaxTokens(state: ReasoningModelState, modelId: string, providerId?: ProviderId): number {
  const context = remoteModelContextInfo(state, modelId, providerId);
  const outputLimit = [
    findProviderCustomModel(state.providerCustomModels, modelId, providerId),
    findFavorite(state.favoriteModels ?? [], modelId, providerId),
    findCachedModel(state.providerModelCache ?? {}, modelId, providerId),
  ].map((model) => model?.maxCompletionTokens)
    .find((limit) => limit != null && Number.isFinite(limit) && limit > 0);
  const contextLimit = getMaxCompletionTokensForContext(context.contextLength);
  if (outputLimit != null) return context.isFallback ? outputLimit : Math.min(outputLimit, contextLimit);
  return context.isFallback ? defaultUserMaxToken : contextLimit;
}
