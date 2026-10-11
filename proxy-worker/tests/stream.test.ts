import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';

const env = { PROXY_AUTH_TOKEN: '' } as Env;
const enc = new TextEncoder();
const cache = new Map<string, Response>();
const ctx = {
  waitUntil(promise: Promise<unknown>) {
    void promise;
  },
} as ExecutionContext;
function body(parts: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(enc.encode(part));
      controller.close();
    },
  });
}
function stream(sessionId: string) {
  return worker.fetch(
    new Request('https://worker.example/api/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://upstream.example/chat',
        headers: {},
        body: { stream: true },
        sessionId,
      }),
    }),
    env,
    ctx
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cache.clear();
});

describe('stream relay', () => {
  it.each([
    ['mid-event', ['data: {"x":1}\n\ndata: [DO', 'NE]\n\n']],
    ['CRLF', ['data: {"x":1}\r\n\r\ndata: [DONE]\r\n\r\n']],
    ['EOF-tail', ['data: {"x":1}\n\ndata: [DONE]']],
    ['large chunk before DONE', [`${'x'.repeat(9_000)}\ndata: [DONE]\n\n`]],
  ])('recognizes %s [DONE] and sends outer done', async (_name, parts) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body(parts)))
    );
    const response = await stream(`done-${_name}`);
    expect(await response.text()).toContain('event: done');
  });

  it('treats EOF without [DONE] as interrupted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body(['data: partial\n\n'])))
    );
    expect(await (await stream('eof')).text()).toContain('event: interrupted');
  });

  it('aborts an idle upstream read even while heartbeat timers are active', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new ReadableStream<Uint8Array>({ start() {} }))
        )
    );
    const response = await stream('idle-upstream');
    const text = response.text();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await text).toContain('event: interrupted');
  });

  it('forwards Retry-After and bounds failed upstream bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x'.repeat(10_000), {
          status: 429,
          headers: { 'Retry-After': '7' },
        })
      )
    );
    const response = await stream('rate-limit');
    expect(response.headers.get('Retry-After')).toBe('7');
    expect((await response.text()).length).toBe(8192);
  });

  it('aborts a request whose initial response headers exceed 45 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: RequestInfo, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          )
      )
    );
    const pending = worker.fetch(
      new Request('https://worker.example/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://upstream.example/request',
          headers: {},
          body: {},
        }),
      }),
      env,
      ctx
    );
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await pending).status).toBe(502);
  });

  it('returns cache-miss immediately', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn(),
        delete: vi.fn(),
      },
    });
    const response = await worker.fetch(
      new Request('https://worker.example/api/recover/missing?lastEventId=8'),
      env,
      ctx
    );
    expect(await response.text()).toContain('event: cache-miss');
  });

  it('replays actual stored IDs and marks an overflow prefix interrupted', async () => {
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              version: 1,
              firstEventId: 1,
              chunks: [
                { id: 3, data: 'three' },
                { id: 4, data: 'four' },
              ],
              generationTerminal: 'complete',
              cacheCapability: 'overflow',
            })
          )
        ),
        put: vi.fn(),
        delete: vi.fn(),
      },
    });
    const response = await worker.fetch(
      new Request('https://worker.example/api/recover/s?lastEventId=3'),
      env,
      ctx
    );
    const text = await response.text();
    expect(text).toContain('id: 4');
    expect(text).toContain('reason":"capacity');
    expect(text).not.toContain('event: done');
  });

  it('reports local and provider cancellation separately', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    );
    const response = await worker.fetch(
      new Request('https://worker.example/api/cancel/other', {
        method: 'POST',
        body: JSON.stringify({
          providerCancel: { generationId: 'g', apiKey: 'k' },
        }),
      }),
      env,
      ctx
    );
    expect(await response.json()).toEqual({
      localAbortRequested: false,
      providerCancel: 'succeeded',
    });
  });
});
