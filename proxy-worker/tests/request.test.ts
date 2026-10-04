import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const env = { PROXY_AUTH_TOKEN: 'secret' } as Env;
const ctx = {} as ExecutionContext;
const invoke = (body: unknown, token = 'secret') => worker.fetch(new Request('https://proxy.test/api/request', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, ctx);
const payload = { endpoint: 'https://openrouter.ai/api/v1/chat/completions', headers: { Authorization: 'Bearer api-key', 'Content-Type': 'application/json', 'X-OpenRouter-Cache': 'true', 'X-OpenRouter-Cache-TTL': '60', 'X-OpenRouter-Cache-Clear': 'true' }, body: { model: 'test', stream: false, provider: { only: ['anthropic'] } } };
afterEach(() => vi.unstubAllGlobals());

describe('HTTP request relay', () => {
  it('forwards settings and returns body and cache observations with CORS', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[]}', { headers: { 'Content-Type': 'application/json', 'X-OpenRouter-Cache-Status': 'HIT', 'X-OpenRouter-Cache-Age': '0', 'X-OpenRouter-Cache-TTL': '60', 'X-OpenRouter-Cache-Source-Id': 'source', 'X-Generation-Id': 'gen', 'Set-Cookie': 'private=value' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await invoke(payload);
    expect(fetcher).toHaveBeenCalledWith(payload.endpoint, expect.objectContaining({ method: 'POST', headers: payload.headers, body: JSON.stringify(payload.body), signal: expect.any(AbortSignal) }));
    expect(await response.json()).toEqual({ choices: [] });
    expect(response.headers.get('X-OpenRouter-Cache-Status')).toBe('HIT');
    expect(response.headers.get('X-OpenRouter-Cache-Age')).toBe('0');
    expect(response.headers.get('X-Generation-Id')).toBe('gen');
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-OpenRouter-Cache-Status');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });
  it('returns upstream errors without replacing their status or body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('parameter unsupported', { status: 400 })));
    const response = await invoke(payload);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('parameter unsupported');
  });
  it('rejects unauthorized and invalid envelopes before reaching upstream', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await invoke(payload, 'wrong')).status).toBe(401);
    for (const body of [null, {}, { endpoint: payload.endpoint, headers: { bad: 1 } }]) expect((await invoke(body)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports upstream connection failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const response = await invoke(payload);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Failed to reach LLM API: offline' });
  });
});
