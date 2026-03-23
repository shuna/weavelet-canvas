import { FavoriteModel, ProviderConfig, ProviderId, ProviderModel } from '@type/provider';

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

const enrichFavoriteModel = (
  favorite: FavoriteModel,
  providerModel: ProviderModel | undefined
): FavoriteModel => {
  if (!providerModel) return favorite;

  return {
    ...favorite,
    contextLength: favorite.contextLength ?? providerModel.contextLength,
    promptPrice: favorite.promptPrice ?? providerModel.promptPrice,
    completionPrice: favorite.completionPrice ?? providerModel.completionPrice,
    modelType: favorite.modelType ?? providerModel.modelType,
    streamSupport: favorite.streamSupport ?? providerModel.streamSupport,
    supportsReasoning: favorite.supportsReasoning ?? providerModel.supportsReasoning,
    supportsVision: favorite.supportsVision ?? providerModel.supportsVision,
    supportsAudio: favorite.supportsAudio ?? providerModel.supportsAudio,
  };
};

export const backfillFavoritesFromProviderModels = (
  favoriteModels: FavoriteModel[],
  providerId: ProviderId,
  models: ProviderModel[]
): FavoriteModel[] => {
  const modelMap = new Map(models.map((model) => [model.id, model]));

  return favoriteModels.map((favorite) => {
    if (favorite.providerId !== providerId) return favorite;
    return enrichFavoriteModel(favorite, modelMap.get(favorite.modelId));
  });
};
