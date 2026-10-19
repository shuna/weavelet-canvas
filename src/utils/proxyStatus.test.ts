import { afterEach, expect, it, vi } from 'vitest';
import { fetchProxyStatus } from './proxyClient';
afterEach(() => vi.unstubAllGlobals());
it('sends credentials only in the Authorization header and encodes requested session IDs', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessions: [] })));
  vi.stubGlobal('fetch', fetcher);
  await fetchProxyStatus({ endpoint: ' https://proxy.example/ ', authToken: 'private-token' }, ['chat:id/?']);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).searchParams.get('sessionId')).toBe('chat:id/?');
  expect(url).not.toContain('private-token');
  expect(init).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer private-token' } });
});
it.each([401, 404, 502])('reports HTTP %s without parsing provider or HTML response content', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private error body', { status })));
  await expect(fetchProxyStatus({ endpoint: 'https://proxy.example' }, [])).rejects.toThrow(/認証|状態API|HTTP 502/);
});
it('rejects an incompatible status response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"ok"}')));
  await expect(fetchProxyStatus({ endpoint: 'https://proxy.example' }, [])).rejects.toThrow('不正');
});
