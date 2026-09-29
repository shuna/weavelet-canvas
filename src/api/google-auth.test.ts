import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { state } = vi.hoisted(() => ({ state: { providers: { google: { connectionId: 'connection-1' as string | undefined } }, setProviderSession: vi.fn() } }));
vi.mock('@store/cloud-auth-store', () => ({ default: { getState: () => state } }));
const fetchMock = vi.fn();
beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_GOOGLE_AUTH_BACKEND', 'true'); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); state.providers.google.connectionId = 'connection-1'; });
afterEach(() => { vi.unstubAllEnvs(); });
const session = (token = 'new-token', connection = 'connection-1') => new Response(JSON.stringify({ access_token: token, expires_in: 3600, connection }), { headers: { 'Content-Type': 'application/json' } });
describe('automatic Google token renewal', () => {
  it('shares renewal between parallel Drive calls and retries a 401 once with a fresh token', async () => {
    const { googleFetch } = await import('./google-auth');
    fetchMock.mockResolvedValueOnce(session()).mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('ok')).mockResolvedValueOnce(session('renewed')).mockResolvedValueOnce(new Response('ok'));
    const responses = await Promise.all([googleFetch('https://www.googleapis.com/drive/v3/files', 'expired'), googleFetch('https://www.googleapis.com/drive/v3/files', 'expired')]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/google/token')).toHaveLength(2);
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.get('Authorization')).toBe('Bearer renewed');
  });
  it('stops before writing to Drive if the browser connection changed', async () => {
    const { googleFetch } = await import('./google-auth');
    fetchMock.mockResolvedValueOnce(session('other-token', 'another-connection'));
    await expect(googleFetch('https://www.googleapis.com/drive/v3/files', 'old', { method: 'PATCH' })).rejects.toThrow('connection changed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('renews backend credentials for encrypted Drive uploads', async () => {
    const { DriveTransport } = await import('../store/storage/google/transport');
    fetchMock.mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(session('renewed'))
      .mockResolvedValueOnce(new Response('ok'));
    await new DriveTransport(() => 'expired').put('file', 'dataset', 'part', new Uint8Array([1]));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/google/token')).toHaveLength(2);
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.get('Authorization')).toBe('Bearer renewed');
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[3][1].body);
  });
  it('stops encrypted uploads when the backend connection changed', async () => {
    const { DriveTransport } = await import('../store/storage/google/transport');
    fetchMock.mockResolvedValueOnce(session('other-token', 'another-connection'));
    await expect(new DriveTransport(() => 'old').put('file', 'dataset', 'part', new Uint8Array([1])))
      .rejects.toThrow('connection changed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not turn an Access login page into a successful token response', async () => {
    const { getGoogleAccessToken } = await import('./google-auth');
    fetchMock.mockResolvedValueOnce(new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(getGoogleAccessToken('old')).rejects.toThrow('Cloudflare Access login required');
  });
  it('keeps direct-token behavior on deployments without a backend', async () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_BACKEND', 'false');
    const { googleFetch } = await import('./google-auth'); fetchMock.mockResolvedValueOnce(new Response('ok'));
    await googleFetch('https://www.googleapis.com/drive/v3/files', 'legacy-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer legacy-token');
  });
});
