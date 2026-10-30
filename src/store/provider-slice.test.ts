import { expect, it } from 'vitest';
import { createProviderSlice, type ProviderSlice } from './provider-slice';
import { DEFAULT_PROVIDERS } from './provider-config';
function store() {
  let state: ProviderSlice;
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  state = createProviderSlice(set as never, (() => state) as never);
  return () => state;
}
it('saves LAN credentials atomically and removes a disabled key without changing OpenAI', () => {
  const get = store();
  get().saveLanProvider({ ...DEFAULT_PROVIDERS.lan, endpoint: 'http://server/chat', modelsRequireAuth: true, apiKey: 'fictional' });
  expect(get().providers.lan.apiKey).toBe('fictional');
  get().setProviderModelCache('lan', [{ id: 'model', name: 'Model', providerId: 'lan' }]);
  get().saveLanProvider({ ...get().providers.lan, modelsRequireAuth: false });
  expect(get().providers.lan.apiKey).toBeUndefined();
  expect(get().providerModelCache.lan).toBeUndefined();
  expect(get().providers.openai).toEqual(DEFAULT_PROVIDERS.openai);
  const before = get().providers;
  expect(() => get().saveLanProvider({ ...get().providers.lan, modelsRequireAuth: true })).toThrow();
  expect(get().providers).toBe(before);
});
it('registers favorites from both entry points without replacing user-edited metadata', () => {
  const get = store();
  get().setProviderModelCache('lan', [{ id: 'custom', name: 'Custom server model', providerId: 'lan', supportsVision: true }]);
  get().toggleFavoriteModel({ modelId: 'custom', providerId: 'lan', supportsReasoning: false });
  expect(get().providerCustomModels.lan?.[0]).toMatchObject({ name: 'Custom server model', supportsVision: true, supportsReasoning: false });
  get().updateProviderCustomModel('lan', 'custom', { supportsVision: false, contextLength: undefined });
  get().toggleFavoriteModel({ modelId: 'custom', providerId: 'lan' });
  get().setFavoriteModels([{ modelId: 'custom', providerId: 'lan', supportsVision: true }, { modelId: 'manual', providerId: 'lan' }]);
  expect(get().providerCustomModels.lan).toHaveLength(2);
  expect(get().providerCustomModels.lan?.[0].supportsVision).toBe(false);
  expect(get().providerCustomModels.lan?.[0].contextLength).toBeUndefined();
});
