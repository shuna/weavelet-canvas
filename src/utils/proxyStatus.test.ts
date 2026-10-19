import { afterEach, expect, it, vi } from 'vitest';
import { deleteProxyStorage, fetchProxyStatus } from './proxyClient';
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value));
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

it('deletes one encoded session with header-only authentication', async () => {
  const fetcher = vi.fn(async () => jsonResponse({ deleted: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(await deleteProxyStorage({ endpoint: ' https://proxy.example/ ', authToken: 'private-token' }, 'chat:id/?')).toBe(1);
  expect(fetcher).toHaveBeenCalledWith('https://proxy.example/api/storage/chat%3Aid%2F%3F', expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer private-token' } }));
});
it('deletes all server pages with a fixed cutoff and reports partial failures', async () => {
  const cursor = 'session:' + 'a'.repeat(64);
  const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({ deleted: 20, failed: 0, before: 100, cursor }))
    .mockResolvedValueOnce(jsonResponse({ deleted: 2, failed: 1, before: 100, cursor: null }));
  vi.stubGlobal('fetch', fetcher);
  await expect(deleteProxyStorage({ endpoint: 'https://proxy.example' })).rejects.toThrow('22件を削除しましたが、1件');
  expect(fetcher.mock.calls[1][0]).toContain('before=100');
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('cursor')).toBe(cursor);
});
it('rejects a repeated deletion cursor instead of looping', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ deleted: 0, failed: 0, before: 100, cursor: 'session:' + 'a'.repeat(64) })));
  await expect(deleteProxyStorage({ endpoint: 'https://proxy.example' })).rejects.toThrow('不正');
});
it.each([401, 403, 404, 500])('reports deletion HTTP %s as failure', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status })));
  await expect(deleteProxyStorage({ endpoint: 'https://proxy.example' }, 'id')).rejects.toThrow(/権限|対応|HTTP/);
});

it('requests the global status page with authenticated headers and a server cursor', async () => {
  const cursor = 'session:' + 'a'.repeat(64);
  const fetcher = vi.fn(async () => jsonResponse({ scope: 'all-sessions', sessions: [], nextCursor: null }));
  vi.stubGlobal('fetch', fetcher);
  await fetchProxyStatus({ endpoint: 'https://proxy.example', authToken: 'secret' }, [], undefined, { all: true, cursor });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).searchParams.get('all')).toBe('1');
  expect(new URL(url).searchParams.get('cursor')).toBe(cursor);
  expect(init.headers).toEqual({ Authorization: 'Bearer secret' });
});
it('rejects an old proxy that cannot enumerate every runtime', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ scope: 'durable-session', sessions: [] })));
  await expect(fetchProxyStatus({ endpoint: 'https://proxy.example' }, [], undefined, { all: true })).rejects.toThrow('全実行環境');
});
