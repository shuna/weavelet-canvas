import i18next from 'i18next';
import useStore from '@store/store';
import type { StoreState } from '@store/store';
import type { FavoriteModel, ProviderId, ProviderModel } from '@type/provider';

type Match = { providerId: ProviderId; model: FavoriteModel | ProviderModel };

export function resolveChatModel(chatIndex: number, state: StoreState = useStore.getState()):
  | { status: 'unspecified' | 'unmatched' | 'local' }
  | { status: 'favorite' | 'available'; match: Match } {
  const config = state.chats?.[chatIndex]?.config;
  if (!config?.model) return { status: 'unspecified' };
  if (config.modelSource === 'local') return { status: 'local' };

  const matchesProvider = (providerId: ProviderId) =>
    !config.providerId || config.providerId === providerId;
  const favorite = state.favoriteModels.find((model) =>
    model.modelId === config.model && matchesProvider(model.providerId)
  );
  if (favorite) return { status: 'favorite', match: { providerId: favorite.providerId, model: favorite } };

  const available: Match[] = [];
  for (const [providerId, models] of Object.entries(state.providerModelCache) as [ProviderId, ProviderModel[]][]) {
    if (!matchesProvider(providerId)) continue;
    const model = models?.find((entry) => entry.id === config.model);
    if (model) available.push({ providerId, model });
  }
  for (const [providerId, models] of Object.entries(state.providerCustomModels) as [ProviderId, { modelId: string; providerId: ProviderId }[]][]) {
    if (!matchesProvider(providerId)) continue;
    const model = models?.find((entry) => entry.modelId === config.model);
    if (model && !available.some((entry) => entry.providerId === providerId)) available.push({ providerId, model: model as FavoriteModel });
  }
  if (available.length === 1) return { status: 'available', match: available[0] };
  return { status: 'unmatched' };
}

export function confirmChatModelFavorite(chatIndex: number): boolean {
  const result = resolveChatModel(chatIndex);
  if (result.status !== 'available') return result.status === 'favorite' || result.status === 'local';
  const state = useStore.getState();
  const modelId = state.chats?.[chatIndex]?.config.model;
  if (!modelId || !window.confirm(i18next.t('model:provider.addFavoriteToContinue', {
    model: modelId,
    defaultValue: 'Add this model to favorites and continue?',
  }) as string)) return false;
  const { providerId, model } = result.match;
  state.setFavoriteModels([...state.favoriteModels, { ...model, modelId, providerId }]);
  return true;
}
