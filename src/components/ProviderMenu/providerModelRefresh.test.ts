import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ effects: [] as (() => unknown)[], state: {} as any, fetch: vi.fn(), cache: vi.fn() }));
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useState: (value: any) => [typeof value === 'function' ? value() : value, vi.fn()],
  useEffect: (effect: () => unknown) => { fixture.effects.push(effect); },
}));
vi.mock('@api/providerModels', () => ({ fetchProviderModels: fixture.fetch }));
vi.mock('@store/store', () => ({ default: Object.assign((select: any) => select(fixture.state), { getState: () => fixture.state }) }));
import { useProviderModels } from './providerMenuHelpers';
import { DEFAULT_PROVIDERS } from '@store/provider-config';
beforeEach(() => {
  vi.clearAllMocks(); fixture.effects = [];
  fixture.state = { providers: { ...DEFAULT_PROVIDERS, lan: { ...DEFAULT_PROVIDERS.lan, endpoint: 'http://server/chat', modelsEndpoint: 'http://server/models' } }, providerModelCache: {}, setProviderModelCache: fixture.cache };
  fixture.fetch.mockResolvedValue([{ id: 'model', providerId: 'lan' }]);
});
it('fetches saved LAN settings on opening even with a previous cached list', async () => {
  fixture.state.providerModelCache = { lan: [{ id: 'old' }] };
  useProviderModels(fixture.state.providers, 'lan');
  for (const effect of fixture.effects) effect();
  await Promise.resolve(); await Promise.resolve();
  expect(fixture.fetch).toHaveBeenCalledWith(fixture.state.providers.lan, expect.any(AbortSignal));
  expect(fixture.cache).toHaveBeenCalledWith('lan', [{ id: 'model', providerId: 'lan' }]);
});
it('does not fetch incomplete saved connection information', () => {
  fixture.state.providers.lan.modelsRequireAuth = true;
  useProviderModels(fixture.state.providers, 'lan');
  for (const effect of fixture.effects) effect();
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it('ignores a delayed result after connection settings change', async () => {
  let finish!: (value: unknown) => void;
  fixture.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  useProviderModels(fixture.state.providers, 'lan');
  for (const effect of fixture.effects) effect();
  fixture.state.providers = { ...fixture.state.providers, lan: { ...fixture.state.providers.lan, endpoint: 'http://new-server/chat' } };
  finish([{ id: 'old-model' }]); await Promise.resolve(); await Promise.resolve();
  expect(fixture.cache).not.toHaveBeenCalled();
});
