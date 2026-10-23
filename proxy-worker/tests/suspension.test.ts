import { afterEach, expect, it, vi } from 'vitest';
import worker, { ProxySession, type Env } from '../src/index';
import { SessionRegistry } from '../src/sessionRegistry';

afterEach(() => vi.unstubAllGlobals());

it('suspends every proxy API before accessing bindings or upstream APIs', async () => {
  const accessed = vi.fn(() => { throw new Error('Unexpected binding access'); });
  const env = new Proxy({ PROXY_SUSPENDED: 'true' }, {
    get(target, key) {
      if (key === 'PROXY_SUSPENDED') return target.PROXY_SUSPENDED;
      return accessed();
    },
  }) as Env;
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const ctx = { waitUntil: accessed } as unknown as ExecutionContext;
  for (const [method, path] of [
    ['POST', '/api/stream'], ['POST', '/api/request'], ['POST', '/api/moderation'],
    ['GET', '/api/status?all=1'], ['GET', '/api/status?sessionId=test'],
    ['GET', '/api/recover/test'], ['POST', '/api/ack/test'],
    ['POST', '/api/cancel/test'], ['DELETE', '/api/storage'], ['DELETE', '/api/storage/test'],
  ]) {
    const response = await worker.fetch(new Request('https://proxy.test' + path, { method }), env, ctx);
    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  }
  const health = await worker.fetch(new Request('https://proxy.test/health'), env, ctx);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'suspended' });
  expect((await worker.fetch(new Request('https://proxy.test/api/stream', { method: 'OPTIONS' }), env, ctx)).status).toBe(204);
  expect(accessed).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});

it('blocks direct Durable Object requests and alarms without touching stored data', async () => {
  const accessed = vi.fn(() => { throw new Error('Unexpected storage access'); });
  const storage = new Proxy({}, { get: accessed });
  const state = { storage } as unknown as DurableObjectState;
  const env = { PROXY_SUSPENDED: 'true' } as Env & { SESSIONS: DurableObjectNamespace };
  for (const object of [new ProxySession(state, env), new SessionRegistry(state, env)]) {
    for (const method of ['GET', 'PUT', 'POST', 'DELETE'])
      expect((await object.fetch(new Request('https://internal/internal/storage', { method }))).status).toBe(503);
    await object.alarm();
  }
  expect(accessed).not.toHaveBeenCalled();
});
