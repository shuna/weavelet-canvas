import { FavoriteModel, ProviderConfig, ProviderId } from '@type/provider';

export const updateProviderConfig = (
  providers: Record<ProviderId, ProviderConfig>,
  providerId: ProviderId,
  patch: Partial<Pick<ProviderConfig, 'apiKey' | 'endpoint'>>
): Record<ProviderId, ProviderConfig> => ({
  ...providers,
  [providerId]: {
    ...providers[providerId],
    ...patch,
  },
});

export const toggleFavoriteModelEntry = (
  favoriteModels: FavoriteModel[],
  model: FavoriteModel
): FavoriteModel[] => {
  const exists = favoriteModels.some(
    (favorite) =>
      favorite.modelId === model.modelId &&
      favorite.providerId === model.providerId
  );

  return exists
    ? favoriteModels.filter(
        (favorite) =>
          !(
            favorite.modelId === model.modelId &&
            favorite.providerId === model.providerId
          )
      )
    : [...favoriteModels, model];
};
