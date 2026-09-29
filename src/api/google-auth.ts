import useCloudAuthStore from '@store/cloud-auth-store';

export const usesGoogleAuthBackend = import.meta.env.VITE_GOOGLE_AUTH_BACKEND === 'true';
type Session = { access_token: string; expires_in: number; connection: string };
let cached: (Session & { expiresAt: number }) | undefined;
let refreshing: Promise<string> | undefined;
let generation = 0;

async function requestSession(action: string, code?: string): Promise<Session> {
  const response = await fetch(`/api/google/${action}`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(code ? { code } : {}),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('401 Cloudflare Access login required. Reload this page.');
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${data.error || 'Google connection failed'}`);
  return data;
}

function cache(session: Session): string {
  if (typeof session.access_token !== 'string' || !session.access_token || typeof session.connection !== 'string' || !Number.isFinite(session.expires_in) || session.expires_in <= 0) throw new Error('Invalid Google connection response');
  cached = { ...session, expiresAt: Date.now() + (session.expires_in - 60) * 1000 };
  return session.access_token;
}

export async function connectGoogle(code: string): Promise<string> {
  const current = ++generation;
  cached = undefined;
  const session = await requestSession('connect', code);
  if (current !== generation) throw new Error('401 Google connection changed');
  const token = cache(session);
  const state = useCloudAuthStore.getState();
  state.setProviderSession('google', { connectionId: session.connection, syncTargetConfirmed: false });
  return token;
}

export async function getGoogleAccessToken(fallback: string, force = false): Promise<string> {
  if (!usesGoogleAuthBackend) return fallback;
  const expected = useCloudAuthStore.getState().providers.google.connectionId;
  if (!expected) throw new Error('401 Google reconnect required');
  if (!force && cached?.connection === expected && cached.expiresAt > Date.now()) return cached.access_token;
  if (!refreshing) {
    const current = generation;
    refreshing = requestSession('token').then(session => {
      if (current !== generation || session.connection !== expected || useCloudAuthStore.getState().providers.google.connectionId !== expected) throw new Error('401 Google connection changed. Reconnect before syncing.');
      return cache(session);
    }).finally(() => { refreshing = undefined; });
  }
  return refreshing;
}

export async function disconnectGoogle(): Promise<void> {
  ++generation;
  cached = undefined;
  if (usesGoogleAuthBackend) await requestSession('disconnect');
  useCloudAuthStore.getState().setProviderSession('google', { connectionId: undefined });
}

export async function googleFetch(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  const token = await getGoogleAccessToken(accessToken);
  let response = await send(token);
  if (response.status === 401 && usesGoogleAuthBackend) response = await send(await getGoogleAccessToken(accessToken, true));
  return response;
}
