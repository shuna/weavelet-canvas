import { afterEach, expect, it, vi } from 'vitest';
import { fetchProviderModels } from './providerModels';
import { DEFAULT_PROVIDERS } from '@store/provider-config';
const provider = { ...DEFAULT_PROVIDERS.lan, endpoint: 'http://server/v1/chat', modelsEndpoint: 'http://server/v1/models' };
afterEach(() => vi.unstubAllGlobals());
it('lists arbitrary model IDs without cloud capability guesses or stale credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'o1-vision' }, { id: 'embedding-custom' }] })));
  vi.stubGlobal('fetch', fetcher);
  const models = await fetchProviderModels({ ...provider, apiKey: 'stale' });
  expect(models).toHaveLength(2);
  expect(models[0]).toMatchObject({ supportsReasoning: false, supportsVision: false });
  expect(models[0].contextLength).toBeUndefined();
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: {}, credentials: 'omit', redirect: 'error' });
});
it('distinguishes empty results from malformed data and HTTP errors', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValueOnce(new Response('{"data":[]}'));
  await expect(fetchProviderModels(provider)).resolves.toEqual([]);
  for (const body of ['{}', '{"data":[{}]}', 'not JSON']) {
    fetcher.mockResolvedValueOnce(new Response(body));
    await expect(fetchProviderModels(provider)).rejects.toThrow();
  }
  for (const status of [401, 403, 404, 405, 500]) {
    fetcher.mockResolvedValueOnce(new Response('', { status }));
    await expect(fetchProviderModels(provider)).rejects.toThrow();
  }
});
it('does not fetch for missing or invalid settings', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(fetchProviderModels(DEFAULT_PROVIDERS.lan)).rejects.toThrow();
  await expect(fetchProviderModels({ ...provider, modelsEndpoint: undefined })).resolves.toEqual([]);
  await expect(fetchProviderModels({ ...provider, modelsEndpoint: 'http://other/models' })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('reads explicit LAN context limits including Strata metadata without guessing missing values', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
    { id: 'strata', meta: { n_ctx: 65536 } },
    { id: 'standard', context_length: 32768, meta: { n_ctx: 65536 } },
    { id: 'window', context_window: 8192 },
    { id: 'invalid', context_length: -1, context_window: 1.5, meta: { n_ctx: '65536' } },
  ] }))));
  const models = await fetchProviderModels(provider);
  expect(models.map(model => model.contextLength)).toEqual([65536, 32768, 8192, undefined]);
});
