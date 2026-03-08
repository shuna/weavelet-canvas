import { StoreSlice } from './store';
import {
  FavoriteModel,
  ProviderConfig,
  ProviderId,
} from '@type/provider';
import { DEFAULT_PROVIDERS } from './provider-config';
import { toggleFavoriteModelEntry, updateProviderConfig } from './provider-helpers';

export interface ProviderSlice {
  providers: Record<ProviderId, ProviderConfig>;
  favoriteModels: FavoriteModel[];
  setProviderApiKey: (id: ProviderId, key: string) => void;
  setProviderEndpoint: (id: ProviderId, endpoint: string) => void;
  toggleFavoriteModel: (model: FavoriteModel) => void;
  setFavoriteModels: (models: FavoriteModel[]) => void;
}

export const createProviderSlice: StoreSlice<ProviderSlice> = (set, get) => ({
  providers: { ...DEFAULT_PROVIDERS },
  favoriteModels: [],
  setProviderApiKey: (id: ProviderId, key: string) => {
    if (get().providers[id]?.apiKey === key) return;
    set((prev: ProviderSlice) => ({
      ...prev,
      providers: updateProviderConfig(prev.providers, id, { apiKey: key }),
    }));
  },
  setProviderEndpoint: (id: ProviderId, endpoint: string) => {
    if (get().providers[id]?.endpoint === endpoint) return;
    set((prev: ProviderSlice) => ({
      ...prev,
      providers: updateProviderConfig(prev.providers, id, { endpoint }),
    }));
  },
  toggleFavoriteModel: (model: FavoriteModel) => {
    set((prev: ProviderSlice) => {
      return {
        ...prev,
        favoriteModels: toggleFavoriteModelEntry(prev.favoriteModels, model),
      };
    });
  },
  setFavoriteModels: (models: FavoriteModel[]) => {
    if (get().favoriteModels === models) return;
    set((prev: ProviderSlice) => ({
      ...prev,
      favoriteModels: models,
    }));
  },
});
