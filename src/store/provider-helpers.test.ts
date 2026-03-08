import { describe, expect, it } from 'vitest';

import type { FavoriteModel } from '@type/provider';
import { DEFAULT_PROVIDERS } from './provider-config';
import { toggleFavoriteModelEntry, updateProviderConfig } from './provider-helpers';

describe('provider-helpers', () => {
  it('updates only the targeted provider config field', () => {
    const updatedProviders = updateProviderConfig(DEFAULT_PROVIDERS, 'openai', {
      apiKey: 'secret-key',
    });

    expect(updatedProviders.openai.apiKey).toBe('secret-key');
    expect(updatedProviders.openai.endpoint).toBe(DEFAULT_PROVIDERS.openai.endpoint);
    expect(updatedProviders.openrouter).toEqual(DEFAULT_PROVIDERS.openrouter);
  });

  it('toggles favorite model entries by provider and model id', () => {
    const favorite: FavoriteModel = {
      modelId: 'gpt-4o',
      providerId: 'openai',
      promptPrice: 1,
      completionPrice: 2,
    };

    const added = toggleFavoriteModelEntry([], favorite);
    expect(added).toEqual([favorite]);

    const removed = toggleFavoriteModelEntry(added, favorite);
    expect(removed).toEqual([]);
  });
});
