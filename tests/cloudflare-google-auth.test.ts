import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { handleGoogleAuth, openToken, sealToken } from '../functions/_lib/google-auth';

let privateKey: CryptoKey;
let jwk: object;
let assertion: string;
let googleIdentity: string;
const db = { prepare: vi.fn(), batch: vi.fn() };
const statement = { bind: vi.fn(), first: vi.fn(), run: vi.fn() };
const env = {
  APP_ORIGIN: 'https://app.example', ACCESS_ISSUER: 'https://werty2.cloudflareaccess.com', ACCESS_AUD: 'app-aud',
  GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_TOKEN_ENCRYPTION_KEY: btoa('x'.repeat(32)), GOOGLE_AUTH_DB: db,
} as unknown as Env;
const fetchMock = vi.fn();
const connection = '00000000-0000-4000-8000-000000000001';
const responseTokens = { access_token: 'short-lived', expires_in: 3600 };
const jwt = (issuer: string, aud: string, sub: string, exp = '1h') => new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(aud).setSubject(sub).setExpirationTime(exp).sign(privateKey);
function request(action: string, options: { origin?: string; auth?: string; body?: string; cookie?: boolean } = {}) {
  return new Request(`https://app.example/api/google/${action}`, {
    method: 'POST', headers: { Origin: options.origin ?? env.APP_ORIGIN, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': options.auth ?? assertion, ...(options.cookie ? { Cookie: `__Host-google-sync=${connection}` } : {}) },
    body: options.body ?? JSON.stringify({ code: 'one-use-code' }),
  });
}
beforeAll(async () => {
  const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey;
  jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  assertion = await jwt(env.ACCESS_ISSUER, env.ACCESS_AUD, 'owner-a');
  googleIdentity = await jwt('https://accounts.google.com', env.GOOGLE_CLIENT_ID, 'google-user');
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  db.prepare.mockReturnValue(statement); statement.bind.mockReturnValue(statement);
  statement.first.mockResolvedValue(null); statement.run.mockResolvedValue({ meta: { changes: 1 } }); db.batch.mockResolvedValue([]);
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('certs')) return Response.json({ keys: [jwk] });
    return Response.json({ ...responseTokens, refresh_token: 'long-lived-secret', scope: 'openid https://www.googleapis.com/auth/drive.file', id_token: googleIdentity });
  });
});
describe('Google auth boundary', () => {
  it('rejects cross-origin, forged, expired and wrong-audience Access assertions before storage or Google token access', async () => {
    const invalid = [request('token', { origin: 'https://attacker.example' }), request('token', { auth: 'forged' }), request('token', { auth: await jwt(env.ACCESS_ISSUER, 'wrong-aud', 'owner-a') }), request('token', { auth: await jwt(env.ACCESS_ISSUER, env.ACCESS_AUD, 'owner-a', '0s') })];
    for (const req of invalid) expect([401, 403]).toContain((await handleGoogleAuth(req, env, 'token')).status);
    expect(db.prepare).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => url === 'https://oauth2.googleapis.com/token')).toBe(false);
  });
  it('stores only authenticated encryption, binds it to the owner, and never returns the refresh token', async () => {
    const response = await handleGoogleAuth(request('connect'), env, 'connect');
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('long-lived-secret');
    expect(response.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Strict');
    const insert = statement.bind.mock.calls.find(args => args.length === 4)!;
    expect(insert[1]).toBe('owner-a');
    expect(await openToken(insert[3], 'owner-a', env)).toBe('long-lived-secret');
    await expect(openToken(insert[3], 'owner-b', env)).rejects.toThrow();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects oversized codes and missing offline grants without creating a connection', async () => {
    expect((await handleGoogleAuth(request('connect', { body: 'x'.repeat(9000) }), env, 'connect')).status).toBe(413);
    fetchMock.mockImplementation(async url => String(url).includes('certs') ? Response.json({ keys: [jwk] }) : Response.json({ ...responseTokens, scope: 'https://www.googleapis.com/auth/drive.file', id_token: googleIdentity }));
    expect((await handleGoogleAuth(request('connect'), env, 'connect')).status).toBe(409);
    expect(db.batch).not.toHaveBeenCalled();
  });
  it('refreshes only the current browser connection belonging to the verified Access owner', async () => {
    statement.first.mockResolvedValue({ sealed_token: await sealToken('refresh-secret', 'owner-a', env) });
    const response = await handleGoogleAuth(request('token', { cookie: true }), env, 'token');
    expect(response.status).toBe(200);
    expect(statement.bind).toHaveBeenCalledWith(connection, 'owner-a');
    const tokenCall = fetchMock.mock.calls.find(([url]) => url === 'https://oauth2.googleapis.com/token')!;
    expect(tokenCall[1].body.get('grant_type')).toBe('refresh_token');
    expect(tokenCall[1].body.get('refresh_token')).toBe('refresh-secret');
    expect(await response.json()).toEqual({ ...responseTokens, connection });
  });
  it('cannot recreate a connection removed by concurrent disconnect', async () => {
    statement.first.mockResolvedValue({ sealed_token: await sealToken('refresh-secret', 'owner-a', env) });
    statement.run.mockResolvedValue({ meta: { changes: 0 } });
    expect((await handleGoogleAuth(request('token', { cookie: true }), env, 'token')).status).toBe(401);
    expect(db.batch).not.toHaveBeenCalled();
  });
  it('disconnect deletes only this browser connection and expires its cookie', async () => {
    const response = await handleGoogleAuth(request('disconnect', { cookie: true }), env, 'disconnect');
    expect(response.status).toBe(200);
    expect(statement.bind).toHaveBeenCalledWith(connection, 'owner-a');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
