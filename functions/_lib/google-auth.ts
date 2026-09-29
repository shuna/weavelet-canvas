import { createRemoteJWKSet, jwtVerify } from 'jose';

const accessKeys = createRemoteJWKSet(new URL('https://werty2.cloudflareaccess.com/cdn-cgi/access/certs'));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const COOKIE = '__Host-google-sync';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(body: object, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function cookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

async function readCode(request: Request): Promise<string> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Authorization code required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data: { code?: unknown };
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!data || typeof data.code !== 'string' || !data.code || data.code.length > 4096) throw new HttpError(400, 'Authorization code required');
  return data.code;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(env.GOOGLE_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('Invalid encryption configuration');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealToken(token: string, owner: string, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(owner) }, await encryptionKey(env), encoder.encode(token));
  const bytes = new Uint8Array(12 + ciphertext.byteLength);
  bytes.set(iv); bytes.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...bytes));
}

export async function openToken(sealed: string, owner: string, env: Env): Promise<string> {
  const bytes = Uint8Array.from(atob(sealed), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(owner) }, await encryptionKey(env), bytes.slice(12));
  return new TextDecoder().decode(plaintext);
}

type Tokens = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope?: string };
async function googleToken(env: Env, parameters: Record<string, string>): Promise<Tokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...parameters }),
  });
  const data = await response.json() as Tokens & { error?: string };
  if (!response.ok) {
    if (data.error === 'invalid_grant') throw new HttpError(401, 'Google reconnect required');
    throw new HttpError(502, 'Google token service unavailable');
  }
  if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new HttpError(502, 'Invalid Google token response');
  return data;
}

export async function handleGoogleAuth(request: Request, env: Env, action: string): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'POST required');
    if (new URL(request.url).origin !== env.APP_ORIGIN || request.headers.get('Origin') !== env.APP_ORIGIN || request.headers.get('X-Requested-With') !== 'XMLHttpRequest') throw new HttpError(403, 'Invalid request origin');
    if (!['connect', 'token', 'disconnect'].includes(action)) throw new HttpError(404, 'Not found');
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!assertion || assertion.length > 16384) throw new HttpError(401, 'Cloudflare Access login required');
    let owner: string;
    try {
      const { payload } = await jwtVerify(assertion, accessKeys, { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'sub'] });
      if (!payload.sub) throw new Error('Missing identity');
      owner = payload.sub;
    } catch { throw new HttpError(401, 'Cloudflare Access login required'); }
    if (!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_TOKEN_ENCRYPTION_KEY || !env.GOOGLE_AUTH_DB) throw new HttpError(503, 'Google sync is not configured');
    const connection = request.headers.get('Cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const id = connection && /^[0-9a-f-]{36}$/.test(connection) ? connection : '';
    const db = env.GOOGLE_AUTH_DB;
    if (action === 'disconnect') {
      if (id) await db.prepare('DELETE FROM google_connections WHERE id = ? AND owner = ?').bind(id, owner).run();
      return json({ disconnected: true }, 200, cookie('', 0));
    }
    if (action === 'connect') {
      const tokens = await googleToken(env, { grant_type: 'authorization_code', code: await readCode(request), redirect_uri: env.APP_ORIGIN });
      if (!tokens.scope?.split(' ').includes(SCOPE)) throw new HttpError(403, 'Google Drive permission required');
      if (!tokens.id_token) throw new HttpError(502, 'Google identity missing');
      const { payload } = await jwtVerify(tokens.id_token, googleKeys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: env.GOOGLE_CLIENT_ID, algorithms: ['RS256'], requiredClaims: ['exp', 'sub'] });
      const previous = id ? await db.prepare('SELECT google_sub, sealed_token FROM google_connections WHERE id = ? AND owner = ?').bind(id, owner).first<{ google_sub: string; sealed_token: string }>() : null;
      const refresh = tokens.refresh_token || (previous && previous.google_sub === payload.sub ? await openToken(previous.sealed_token, owner, env) : undefined);
      if (!refresh) throw new HttpError(409, 'Google offline permission required. Remove this app from Google Account permissions, then reconnect.');
      const nextId = crypto.randomUUID();
      const sealed = await sealToken(refresh, owner, env);
      await db.batch([
        db.prepare('INSERT INTO google_connections (id, owner, google_sub, sealed_token) VALUES (?, ?, ?, ?)').bind(nextId, owner, payload.sub, sealed),
        db.prepare('DELETE FROM google_connections WHERE id = ? AND owner = ?').bind(id, owner),
      ]);
      return json({ access_token: tokens.access_token, expires_in: tokens.expires_in, connection: nextId }, 200, cookie(nextId, 31536000));
    }
    const saved = id ? await db.prepare('SELECT sealed_token FROM google_connections WHERE id = ? AND owner = ?').bind(id, owner).first<{ sealed_token: string }>() : null;
    if (!saved) throw new HttpError(401, 'Google reconnect required');
    let tokens: Tokens;
    try { tokens = await googleToken(env, { grant_type: 'refresh_token', refresh_token: await openToken(saved.sealed_token, owner, env) }); }
    catch (error) {
      if (error instanceof HttpError && error.status === 401) await db.prepare('DELETE FROM google_connections WHERE id = ? AND owner = ? AND sealed_token = ?').bind(id, owner, saved.sealed_token).run();
      throw error;
    }
    // A concurrent disconnect must not recreate a deleted connection.
    const result = await db.prepare('UPDATE google_connections SET sealed_token = ? WHERE id = ? AND owner = ? AND sealed_token = ?').bind(tokens.refresh_token ? await sealToken(tokens.refresh_token, owner, env) : saved.sealed_token, id, owner, saved.sealed_token).run();
    if (!result.meta.changes) throw new HttpError(401, 'Google reconnect required');
    return json({ access_token: tokens.access_token, expires_in: tokens.expires_in, connection: id });
  } catch (error) {
    // Never log Google responses, authorization codes, cookies, or tokens.
    return json({ error: error instanceof HttpError ? error.message : 'Google connection service unavailable' }, error instanceof HttpError ? error.status : 503);
  }
}
