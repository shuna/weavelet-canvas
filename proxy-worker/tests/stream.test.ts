import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { sessionDiagnostics } from '../src/diagnostics';

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
function stream(sessionId: string, signal?: AbortSignal) {
  return worker.fetch(
    new Request('https://worker.example/api/stream', {
      method: 'POST',
      signal,
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
beforeEach(() => {
  vi.stubGlobal('caches', { default: {
    match: vi.fn(async (key: Request) => cache.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => { cache.set(key.url, response); }),
    delete: vi.fn(async (key: Request) => cache.delete(key.url)),
  } });
});
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

  it('completes on DONE without waiting for the upstream HTTP body to close', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(enc.encode('data: [DONE]\n\n')); }, cancel,
    }))));
    const response = await stream('done-with-open-body');
    expect(await response.text()).toContain('event: done');
    expect(cancel).toHaveBeenCalled();
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
    let started!: () => void;
    const readStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new ReadableStream<Uint8Array>(
            { pull() { started(); } },
            { highWaterMark: 0 }
          ))
        )
    );
    const response = await stream('idle-upstream');
    const text = response.text();
    // Native cache-key hashing can finish after fake timers advance. Demand
    // begins only once the relay has installed its heartbeat and idle timers.
    await readStarted;
    await vi.advanceTimersByTimeAsync(45_000);
    const relayed = await text;
    expect(relayed).toContain(': ping');
    expect(relayed).toContain('event: interrupted');
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

  it('continues periodic snapshots after forty writes on a long connected stream', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        let count = 0;
        const timer = setInterval(() => {
          controller.enqueue(enc.encode(`data: ${++count}\n\n`));
          if (count === 45) { clearInterval(timer); controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); }
        }, 10_000);
      },
    }))));
    const response = await stream('long-periodic-snapshots');
    const output = response.text();
    await vi.advanceTimersByTimeAsync(450_001);
    expect(await output).toContain('event: done');
    expect(vi.mocked(caches.default.put).mock.calls.length).toBeGreaterThan(42);
    expect(sessionDiagnostics().find(s => s.sessionId === 'long-periodic-snapshots')?.cacheWrites).toBeGreaterThan(42);
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

  it('recovers a completed response when the terminal delivery was lost, and ACK deletes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body(['data: hello\n\n', 'data: [DONE]\n\n']))));
    expect(await (await stream('chat:request/id?#')).text()).toContain('event: done');
    const recover = () => worker.fetch(new Request('https://worker.example/api/recover/' + encodeURIComponent('chat:request/id?#') + '?lastEventId=1'), env, ctx);
    const recovered = await (await recover()).text();
    expect(recovered).toContain('id: 2');
    expect(recovered).not.toContain('id: 1');
    expect(recovered).toContain('event: done');
    const ack = await worker.fetch(new Request('https://worker.example/api/ack/' + encodeURIComponent('chat:request/id?#'), { method: 'POST' }), env, ctx);
    expect(await ack.json()).toEqual({ deleted: true });
    expect(await (await recover()).text()).toContain('event: cache-miss');
  });

  it('keeps consuming and caches after abort interrupts a blocked client write', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; } }))));
    const abort = new AbortController();
    const response = await stream('blocked-write', abort.signal);
    source.enqueue(enc.encode('data: first\n\n'));
    await vi.waitFor(() => expect(cache.size).toBe(1));
    // Leave the response unread: writer.write is held by backpressure.
    abort.abort();
    source.enqueue(enc.encode('data: second\n\ndata: [DONE]\n\n'));
    source.close();
    await vi.waitFor(async () => {
      expect((await [...cache.values()][0].clone().json()).generationTerminal).toBe('complete');
    });
    const recovered = await worker.fetch(new Request('https://worker.example/api/recover/blocked-write?lastEventId=0'), env, ctx);
    const replay = await recovered.text();
    expect(replay).toContain('first');
    expect(replay).toContain('second');
    expect(replay).toContain('event: done');
    await response.body?.cancel().catch(() => {});
  });

  it.each(['-1', 'NaN', '1.5', '1junk', '9007199254740992'])('rejects invalid recovery cursor %s', async cursor => {
    const response = await worker.fetch(new Request('https://worker.example/api/recover/s?lastEventId=' + cursor), env, ctx);
    expect(response.status).toBe(400);
  });

  it.each([0, 4])('rejects a missing prefix or a cursor ahead of the stored stream: %s', async cursor => {
    vi.stubGlobal('caches', { default: { match: async () => new Response(JSON.stringify({
      version: 1, firstEventId: 2, chunks: [{ id: 2, data: 'two' }],
      generationTerminal: 'complete', cacheCapability: 'available',
    })) } });
    const response = await worker.fetch(new Request('https://worker.example/api/recover/s?lastEventId=' + cursor), env, ctx);
    const replay = await response.text();
    expect(replay).toContain('event-id-mismatch');
    expect(replay).not.toContain('event: done');
  });

  it('enforces snapshot expiry even if a cache implementation still returns the entry', async () => {
    vi.stubGlobal('caches', { default: { match: async () => new Response(JSON.stringify({
      version: 1, expiresAt: Date.now() - 1, firstEventId: 1, chunks: [],
      generationTerminal: 'complete', cacheCapability: 'available',
    })) } });
    const response = await worker.fetch(new Request('https://worker.example/api/recover/s'), env, ctx);
    expect(await response.text()).toContain('event: cache-miss');
  });

  it('publishes the terminal snapshot before sending the terminal SSE event', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let terminalWriteStarted = false;
    vi.stubGlobal('caches', { default: {
      put: async (key: Request, response: Response) => {
        const snapshot = await response.clone().json() as { generationTerminal: string };
        if (snapshot.generationTerminal === 'complete') { terminalWriteStarted = true; await gate; }
        cache.set(key.url, response);
      },
    } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body(['data: [DONE]\n\n']))));
    let finished = false;
    const text = (await stream('terminal-order')).text().then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(terminalWriteStarted).toBe(true));
    expect(finished).toBe(false);
    release();
    expect(await text).toContain('event: done');
    expect((await [...cache.values()][0].clone().json()).generationTerminal).toBe('complete');
  });

  it('waits for a newer streaming snapshot when the saved cursor is ahead of the cache', async () => {
    vi.useFakeTimers();
    const match = vi.fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify({ version: 1, firstEventId: 1, chunks: [], generationTerminal: 'streaming', cacheCapability: 'available' })))
      .mockImplementation(async () => new Response(JSON.stringify({ version: 1, firstEventId: 1, chunks: [{ id: 1, data: 'one' }, { id: 2, data: 'two' }], generationTerminal: 'complete', cacheCapability: 'available' })));
    vi.stubGlobal('caches', { default: { match } });
    const replay = (await worker.fetch(new Request('https://worker.example/api/recover/s?lastEventId=1'), env, ctx)).text();
    await vi.waitFor(() => expect(match).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_100);
    const text = await replay;
    expect(text).toContain('id: 2');
    expect(text).toContain('event: done');
    expect(text).not.toContain('event-id-mismatch');
  });

  it('recovers a large reply from the retained tail and rejects a cursor before that window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body(['data: ' + 'x'.repeat(400_000) + '\n\n', 'data: ' + 'y'.repeat(400_000) + '\n\n', 'data: ' + 'z'.repeat(400_000) + '\n\n', 'data: [DONE]\n\n']))));
    expect(await (await stream('large-tail')).text()).toContain('event: done');
    const request = (cursor: number) => worker.fetch(new Request('https://worker.example/api/recover/large-tail?lastEventId=' + cursor), env, ctx);
    const recovered = await (await request(2)).text();
    expect(recovered).toContain('id: 3');
    expect(recovered).toContain('event: done');
    expect(recovered).not.toContain('event: interrupted');
    expect(await (await request(0)).text()).toContain('event-id-mismatch');
    const stored = await [...cache.values()][0].clone().json();
    expect(stored.firstEventId).toBe(2);
    expect(stored.lastEventId).toBe(4);
    expect(sessionDiagnostics().find(s => s.sessionId === 'large-tail')!.bufferedBytes).toBeLessThanOrEqual(1_048_576);
  });

  it('bounds a blocked downstream write even when the runtime does not signal a client abort', async () => {
    vi.useFakeTimers();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      const response = new Response(new ReadableStream<Uint8Array>({ start(c) { upstream = c; c.enqueue(enc.encode('data: first\n\n')); } }));
      init.signal?.addEventListener('abort', () => upstream.error(new Error('aborted')));
      return Promise.resolve(response);
    }));
    const response = await stream('backpressure-timeout');
    await vi.waitFor(() => expect(sessionDiagnostics().find(s => s.sessionId === 'backpressure-timeout')!.lastEventId).toBe(1));
    await vi.advanceTimersByTimeAsync(36_000);
    expect(sessionDiagnostics().find(s => s.sessionId === 'backpressure-timeout')).toMatchObject({ phase: 'interrupted', reason: 'client-write-timeout' });
    const saved = await [...cache.values()][0].clone().json();
    expect(saved.generationTerminal).toBe('interrupted');
    await response.body?.cancel().catch(() => {});
  });

  it('authenticates status queries and returns counters without prompts or provider credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body(['data: private-prompt-text\n\ndata: [DONE]\n\n']))));
    await (await stream('status-session')).text();
    const request = (authorization?: string) => new Request('https://worker.example/api/status?sessionId=status-session', { headers: authorization ? { Authorization: authorization } : {} });
    expect((await worker.fetch(request(), { PROXY_AUTH_TOKEN: 'secret' }, ctx)).status).toBe(401);
    const response = await worker.fetch(request('Bearer secret'), { PROXY_AUTH_TOKEN: 'secret' }, ctx);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = await response.json();
    const session = result.sessions.find((s: any) => s.sessionId === 'status-session');
    expect(session.local).toMatchObject({ phase: 'complete', lastEventId: 1, cacheFailures: 0 });
    expect(session.cache).toMatchObject({ state: 'available', terminal: 'complete', lastEventId: 1 });
    expect(JSON.stringify(result)).not.toContain('private-prompt-text');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('reports an unknown cache separately from an expired entry, and bounds lookups', async () => {
    vi.stubGlobal('caches', { default: { match: async (key: Request) => key.url ? new Response(JSON.stringify({ expiresAt: Date.now() - 1, chunks: [], firstEventId: 1, generationTerminal: 'interrupted', cacheCapability: 'available' })) : undefined } });
    const result = await (await worker.fetch(new Request('https://worker.example/api/status?sessionId=expired-status'), env, ctx)).json();
    expect(result.sessions.find((s: any) => s.sessionId === 'expired-status').cache.state).toBe('expired');
    const tooMany = new URL('https://worker.example/api/status');
    for (let n = 0; n < 21; n++) tooMany.searchParams.append('sessionId', String(n));
    expect((await worker.fetch(new Request(tooMany), env, ctx)).status).toBe(400);
  });

  it('reads compact cache metadata without parsing the stored response body', async () => {
    const json = vi.fn().mockRejectedValue(new Error('must not download the stream body'));
    const cancel = vi.fn();
    vi.stubGlobal('caches', { default: { match: async () => ({
      headers: new Headers({ 'X-Weavelet-Status': JSON.stringify({ firstEventId: 10, lastEventId: 20, terminal: 'complete', expiresAt: Date.now() + 1000 }) }),
      json, body: new ReadableStream({ cancel }),
    }) } });
    const response = await worker.fetch(new Request('https://worker.example/api/status?sessionId=metadata-only'), env, ctx);
    const result = await response.json();
    expect(result.sessions.find((s: any) => s.sessionId === 'metadata-only').cache).toMatchObject({ state: 'available', firstEventId: 10, lastEventId: 20 });
    expect(json).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });

  it('never enumerates session IDs when proxy authentication is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body(['data: [DONE]\n\n']))));
    await (await stream('private-capability-session')).text();
    const result = await (await worker.fetch(new Request('https://worker.example/api/status'), env, ctx)).json();
    expect(result.recentSessionsVisible).toBe(false);
    expect(result.sessions).toEqual([]);
    const known = await (await worker.fetch(new Request('https://worker.example/api/status?sessionId=private-capability-session'), env, ctx)).json();
    expect(known.sessions).toHaveLength(1);
    expect(known.sessions[0].sessionId).toBe('private-capability-session');
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
