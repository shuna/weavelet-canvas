import { normalizeModels } from '../../src/api/providerModels';
import { backfillFavoritesFromProviderModels } from '../../src/store/provider-helpers';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { ProviderId, ProviderModel, FavoriteModel } from '../../src/types/provider';

type ModelCacheState = { favoriteModels?: FavoriteModel[]; providerModelCache?: Partial<Record<ProviderId, ProviderModel[]>> };
export function providerModelList(json: string): string {
  const input = JSON.parse(json) as { operation?: 'normalize' | 'cache'; providerId: ProviderId; data?: unknown;
    state?: ModelCacheState; models?: ProviderModel[] };
  if (input.operation === 'cache') {
    if (!input.state || !input.models) throw new Error('Missing model cache input.');
    const state = input.state;
    const next = { ...state, providerModelCache: { ...state.providerModelCache, [input.providerId]: input.models },
      favoriteModels: backfillFavoritesFromProviderModels(state.favoriteModels ?? [], input.providerId, input.models) };
    return JSON.stringify({ changes: diffJSONChanges(state, JSON.parse(JSON.stringify(next))) });
  }
  if (input.operation !== undefined && input.operation !== 'normalize') throw new Error('Unknown provider model operation.');
  return JSON.stringify({ models: normalizeModels(input.providerId, input.data) });
}
