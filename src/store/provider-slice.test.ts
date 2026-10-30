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

it('refreshes LAN context metadata without changing current or historical chat parameters', () => {
  const get = store();
  const config = { model: 'custom', providerId: 'lan', max_tokens: 700, temperature: 0.3, modelSettings: { saved: { max_tokens: 123 } } };
  const chats = [{ id: 'one', config }];
  Object.assign(get(), { chats });
  get().addProviderCustomModel({ modelId: 'custom', providerId: 'lan', modelType: 'text', contextLength: 8192, supportsVision: true });
  get().setFavoriteModels([{ modelId: 'custom', providerId: 'lan', contextLength: 8192 }]);
  get().setProviderModelCache('lan', [{ id: 'custom', name: 'Custom', providerId: 'lan', contextLength: 65536 }]);
  expect(get().providerCustomModels.lan?.[0]).toMatchObject({ contextLength: 65536, supportsVision: true });
  expect(get().favoriteModels[0].contextLength).toBe(65536);
  expect((get() as any).chats).toBe(chats);
  expect(chats[0].config).toBe(config);
  expect(chats[0].config.max_tokens).toBe(700);
  expect(chats[0].config.modelSettings.saved.max_tokens).toBe(123);
});
