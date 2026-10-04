export interface Env {
  PROXY_AUTH_TOKEN: string;
}
interface StreamRequest {
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
  sessionId: string;
}
interface ModerationProxyRequest {
  endpoint: string;
  apiKey: string;
  input: string;
}
interface CachedChunk {
  id: number;
  data: string;
}
interface CachedSession {
  version: 1;
  firstEventId: number;
  chunks: CachedChunk[];
  generationTerminal: 'streaming' | 'complete' | 'interrupted' | 'failed';
  cacheCapability: 'available' | 'overflow';
  error?: string;
  openRouterObservation?: Record<string, string | number>;
}
interface ActiveStream {
  abortController: AbortController;
  apiKey?: string;
}
interface CancelRequest {
  providerCancel?: { generationId: string; apiKey: string };
}
const activeStreams = new Map<string, ActiveStream>();
const MAX_RECOVERY_CACHE_BYTES = 1_048_576,
  HEADER_TIMEOUT_MS = 45_000,
  DISCONNECT_READ_LIMIT_MS = 20_000,
  DISCONNECT_CACHE_LIMIT_MS = 25_000,
  SNAPSHOT_INTERVAL_MS = 10_000,
  RECOVERY_POLL_INTERVAL_MS = 2_000,
  RECOVERY_POLL_TIMEOUT_MS = 25_000,
  BODY_IDLE_TIMEOUT_MS = 45_000,
  ERROR_BODY_LIMIT = 8 * 1024;
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers':
    'X-OpenRouter-Cache-Status, X-OpenRouter-Cache-Age, X-OpenRouter-Cache-TTL, X-OpenRouter-Cache-Source-Id, X-Generation-Id, Retry-After',
};
const isStringRecord = (v: unknown): v is Record<string, string> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === 'string');
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const timeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, sleep(ms).then(() => undefined as T | undefined)]);
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), BODY_IDLE_TIMEOUT_MS);
    void reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
function withCORS(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
const jsonResponse = (data: unknown, status = 200) =>
  withCORS(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
const sseResponse = (body: ReadableStream) =>
  withCORS(
    new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  );
const authenticated = (request: Request, env: Env) =>
  !env.PROXY_AUTH_TOKEN ||
  request.headers.get('Authorization') === `Bearer ${env.PROXY_AUTH_TOKEN}`;
async function cacheKey(
  sessionId: string,
  requestUrl: string
): Promise<Request> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sessionId)
  );
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  return new Request(
    `${new URL(requestUrl).origin}/_weavelet_stream_cache/v1/${hash}`
  );
}
const cacheResponse = (s: CachedSession) =>
  new Response(JSON.stringify(s), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=300',
    },
  });
async function boundedBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < ERROR_BODY_LIMIT) {
      const next = await readWithIdleTimeout(reader);
      if (!next) break;
      const { done, value } = next;
      if (done) break;
      const part = value.subarray(0, ERROR_BODY_LIMIT - length);
      chunks.push(part);
      length += part.byteLength;
      if (part.byteLength !== value.byteLength) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    all.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(all);
}
async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {}
}
async function fetchWithHeaderTimeout(
  input: RequestInfo,
  init: RequestInit
): Promise<Response> {
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), HEADER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}
function upstreamHeaders(response: Response): Headers {
  const h = new Headers();
  for (const n of [
    'Content-Type',
    'Retry-After',
    'X-OpenRouter-Cache-Status',
    'X-OpenRouter-Cache-Age',
    'X-OpenRouter-Cache-TTL',
    'X-OpenRouter-Cache-Source-Id',
    'X-Generation-Id',
  ]) {
    const v = response.headers.get(n);
    if (v !== null) h.set(n, v);
  }
  return h;
}
function observations(headers: Headers) {
  const out: Record<string, string | number> = {},
    fields: Record<string, string> = {
      responseCacheStatus: 'X-OpenRouter-Cache-Status',
      responseCacheAge: 'X-OpenRouter-Cache-Age',
      responseCacheTTL: 'X-OpenRouter-Cache-TTL',
      responseCacheSourceId: 'X-OpenRouter-Cache-Source-Id',
      generationId: 'X-Generation-Id',
    };
  for (const [k, n] of Object.entries(fields)) {
    const v = headers.get(n);
    if (v !== null)
      out[k] =
        k === 'responseCacheAge' || k === 'responseCacheTTL' ? Number(v) : v;
  }
  return out;
}
function scanDone(scanner: { pending: string; done: boolean }, text: string) {
  const lines = (scanner.pending + text).split(/\r?\n/);
  scanner.pending = (lines.pop() ?? '').slice(-8192);
  for (const line of lines)
    if (/^data:\s*\[DONE\]\s*$/.test(line)) scanner.done = true;
}

async function handleStream(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  let parsed: StreamRequest;
  try {
    parsed = (await request.json()) as StreamRequest;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const { endpoint, headers, body, sessionId } = parsed;
  if (
    !endpoint ||
    !sessionId ||
    typeof endpoint !== 'string' ||
    typeof sessionId !== 'string'
  )
    return jsonResponse({ error: 'endpoint and sessionId are required' }, 400);
  if (!isStringRecord(headers))
    return jsonResponse(
      { error: 'headers must be an object of string values' },
      400
    );
  const abort = new AbortController(),
    headerTimer = setTimeout(() => abort.abort(), HEADER_TIMEOUT_MS),
    apiKey =
      headers.Authorization?.replace(/^Bearer\s+/i, '') ??
      headers.authorization?.replace(/^Bearer\s+/i, '');
  activeStreams.set(sessionId, { abortController: abort, apiKey });
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (e) {
    clearTimeout(headerTimer);
    activeStreams.delete(sessionId);
    return jsonResponse(
      { error: `Failed to reach LLM API: ${(e as Error).message}` },
      502
    );
  }
  clearTimeout(headerTimer);
  if (!upstream.ok) {
    activeStreams.delete(sessionId);
    const text = await boundedBody(upstream);
    return withCORS(
      new Response(text, {
        status: upstream.status,
        headers: upstreamHeaders(upstream),
      })
    );
  }
  if (!upstream.body) {
    activeStreams.delete(sessionId);
    return jsonResponse({ error: 'LLM API returned no body' }, 502);
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const process = async () => {
    const reader = upstream.body!.getReader(),
      writer = writable.getWriter(),
      encoder = new TextEncoder(),
      decoder = new TextDecoder(),
      key = await cacheKey(sessionId, request.url),
      observation = observations(upstream.headers),
      chunks: CachedChunk[] = [],
      scanner = { pending: '', done: false };
    let bytes = 0,
      eventId = 0,
      overflow = false,
      disconnected = false,
      terminalDelivered = false,
      snapshotInflight = false,
      readAt = 0;
    let readTimer: ReturnType<typeof setTimeout> | undefined,
      heartbeat: ReturnType<typeof setInterval> | undefined,
      snapshotTimer: ReturnType<typeof setInterval> | undefined,
      snapshotChain: Promise<void> = Promise.resolve(),
      writeChain: Promise<void> = Promise.resolve();
    const startDisconnected = () => {
      if (disconnected || terminalDelivered) return;
      disconnected = true;
      readAt = Date.now();
      void snapshot('streaming', true);
      readTimer = setTimeout(() => abort.abort(), DISCONNECT_READ_LIMIT_MS);
      snapshotTimer = setInterval(() => {
        void snapshot('streaming');
      }, SNAPSHOT_INTERVAL_MS);
    };
    const write = async (text: string): Promise<boolean> => {
      const writeAttempt = writeChain.then(() =>
        writer.write(encoder.encode(text))
      );
      writeChain = writeAttempt.catch(() => undefined);
      try {
        await writeAttempt;
        return true;
      } catch {
        startDisconnected();
        return false;
      }
    };
    const snapshot = (
      terminal: CachedSession['generationTerminal'],
      force = false
    ): Promise<void> => {
      if (!disconnected || (!force && snapshotInflight)) return snapshotChain;
      const copy: CachedSession = {
        version: 1,
        firstEventId: chunks[0]?.id ?? eventId + 1,
        chunks: chunks.map((c) => ({ ...c })),
        generationTerminal: terminal,
        cacheCapability: overflow ? 'overflow' : 'available',
        openRouterObservation: { ...observation },
        ...(error ? { error } : {}),
      };
      snapshotInflight = true;
      snapshotChain = snapshotChain.then(async () => {
        try {
          await caches.default.put(key, cacheResponse(copy));
        } catch (e) {
          console.error('stream cache write failed:', (e as Error).message);
        } finally {
          snapshotInflight = false;
        }
      });
      return snapshotChain;
    };
    const onRequestAbort = () => {
      startDisconnected();
      // Preserve the first snapshot even if this runtime tears down the
      // response-facing task as soon as the client aborts.
      ctx.waitUntil(snapshotChain);
    };
    request.signal.addEventListener('abort', onRequestAbort, { once: true });
    void writer.closed.catch(() => startDisconnected());
    heartbeat = setInterval(() => {
      if (!disconnected && !terminalDelivered) void write(': ping\n\n');
    }, 5_000);
    let terminal: CachedSession['generationTerminal'] = 'interrupted',
      error: string | undefined;
    try {
      while (true) {
        const read = await readWithIdleTimeout(reader);
        if (!read) {
          abort.abort();
          try {
            await reader.cancel('Upstream stream idle timeout');
          } catch {}
          throw new Error('Upstream stream idle timeout');
        }
        const { done, value } = read;
        if (done) break;
        const data = decoder.decode(value, { stream: true });
        scanDone(scanner, data);
        eventId++;
        const size = new TextEncoder().encode(data).byteLength;
        if (!overflow && bytes + size <= MAX_RECOVERY_CACHE_BYTES) {
          chunks.push({ id: eventId, data });
          bytes += size;
        } else overflow = true;
        if (!disconnected)
          await write(`id: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`);
      }
      scanDone(scanner, decoder.decode());
      if (/^data:\s*\[DONE\]\s*$/.test(scanner.pending)) scanner.done = true;
      terminal = scanner.done ? 'complete' : 'interrupted';
      if (!scanner.done) error = 'Upstream stream ended before [DONE]';
    } catch (e) {
      terminal = abort.signal.aborted ? 'interrupted' : 'failed';
      error = errorMessage(e);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (readTimer) clearTimeout(readTimer);
      if (!disconnected) {
        const event =
          terminal === 'complete'
            ? 'done'
            : terminal === 'failed'
              ? 'error'
              : 'interrupted';
        if (
          await write(
            `event: ${event}\ndata: ${JSON.stringify({ totalChunks: eventId, openRouterObservation: observation, complete: terminal === 'complete', ...(error ? { error } : {}) })}\n\n`
          )
        )
          terminalDelivered = true;
      }
      if (disconnected)
        await timeout(
          snapshot(terminal, true),
          Math.max(0, DISCONNECT_CACHE_LIMIT_MS - (Date.now() - readAt))
        );
      // A terminal write can discover the disconnect after the earlier timer
      // cleanup, so clear the timers started by that late transition too.
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (readTimer) clearTimeout(readTimer);
      request.signal.removeEventListener('abort', onRequestAbort);
      activeStreams.delete(sessionId);
      try {
        await reader.cancel();
      } catch {}
      reader.releaseLock();
      try {
        await writer.close();
      } catch {}
    }
  };
  ctx.waitUntil(process());
  const response = sseResponse(readable);
  for (const [name, value] of upstreamHeaders(upstream))
    response.headers.set(name, value);
  return response;
}

async function handleRecover(
  sessionId: string,
  lastEventId: number,
  request: Request,
  ctx: ExecutionContext
): Promise<Response> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(),
    writer = writable.getWriter(),
    enc = new TextEncoder();
  const run = async () => {
    const started = Date.now();
    let sent = lastEventId;
    try {
      while (true) {
        const response = await caches.default.match(
          await cacheKey(sessionId, request.url)
        );
        if (!response) {
          await writer.write(
            enc.encode('event: cache-miss\ndata: {"complete":false}\n\n')
          );
          break;
        }
        let cached: CachedSession;
        try {
          cached = (await response.json()) as CachedSession;
        } catch {
          await writer.write(
            enc.encode(
              'event: error\ndata: {"error":"Corrupt session data"}\n\n'
            )
          );
          break;
        }
        for (const chunk of cached.chunks)
          if (chunk.id > sent) {
            sent = chunk.id;
            await writer.write(
              enc.encode(
                `id: ${chunk.id}\ndata: ${JSON.stringify(chunk.data)}\n\n`
              )
            );
          }
        if (cached.cacheCapability === 'overflow') {
          await writer.write(
            enc.encode(
              `event: interrupted\ndata: ${JSON.stringify({ totalChunks: sent, complete: false, reason: 'capacity', openRouterObservation: cached.openRouterObservation })}\n\n`
            )
          );
          break;
        }
        if (cached.generationTerminal !== 'streaming') {
          const event =
            cached.generationTerminal === 'complete'
              ? 'done'
              : cached.generationTerminal === 'failed'
                ? 'error'
                : 'interrupted';
          await writer.write(
            enc.encode(
              `event: ${event}\ndata: ${JSON.stringify({ totalChunks: sent, complete: cached.generationTerminal === 'complete', error: cached.error, openRouterObservation: cached.openRouterObservation })}\n\n`
            )
          );
          break;
        }
        if (Date.now() - started >= RECOVERY_POLL_TIMEOUT_MS) {
          await writer.write(
            enc.encode(
              `event: interrupted\ndata: ${JSON.stringify({ totalChunks: sent, complete: false })}\n\n`
            )
          );
          break;
        }
        await sleep(RECOVERY_POLL_INTERVAL_MS);
      }
    } catch {
    } finally {
      try {
        await writer.close();
      } catch {}
    }
  };
  ctx.waitUntil(run());
  return sseResponse(readable);
}
async function handleRequest(request: Request): Promise<Response> {
  let p: Omit<StreamRequest, 'sessionId'>;
  try {
    p = (await request.json()) as Omit<StreamRequest, 'sessionId'>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (
    !p?.endpoint ||
    typeof p.endpoint !== 'string' ||
    !isStringRecord(p.headers)
  )
    return jsonResponse(
      { error: 'endpoint and string headers are required' },
      400
    );
  let r: Response;
  try {
    r = await fetchWithHeaderTimeout(p.endpoint, {
      method: 'POST',
      headers: p.headers,
      body: JSON.stringify(p.body),
    });
  } catch (e) {
    return jsonResponse(
      { error: `Failed to reach LLM API: ${(e as Error).message}` },
      502
    );
  }
  if (!r.ok) {
    const body = await boundedBody(r);
    return withCORS(
      new Response(body, { status: r.status, headers: upstreamHeaders(r) })
    );
  }
  return withCORS(
    new Response(r.body, { status: r.status, headers: upstreamHeaders(r) })
  );
}
async function handleModeration(request: Request): Promise<Response> {
  let p: ModerationProxyRequest;
  try {
    p = (await request.json()) as ModerationProxyRequest;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!p?.endpoint || !p.apiKey || typeof p.input !== 'string')
    return jsonResponse(
      { error: 'endpoint, apiKey, and input are required' },
      400
    );
  let r: Response;
  try {
    r = await fetchWithHeaderTimeout(p.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({ input: p.input }),
    });
  } catch (e) {
    return jsonResponse(
      { error: `Failed to reach Moderation API: ${(e as Error).message}` },
      502
    );
  }
  const body = await boundedBody(r);
  return withCORS(
    new Response(body, { status: r.status, headers: upstreamHeaders(r) })
  );
}
async function handleCancel(
  sessionId: string,
  request: Request
): Promise<Response> {
  let payload: CancelRequest = {};
  try {
    payload = (await request.json()) as CancelRequest;
  } catch {}
  const local = activeStreams.get(sessionId);
  if (local) local.abortController.abort();
  let providerCancel: 'not-requested' | 'succeeded' | 'failed' =
    'not-requested';
  const p = payload.providerCancel;
  if (p?.generationId && p.apiKey)
    try {
      const r = await fetchWithHeaderTimeout(
        `https://openrouter.ai/api/v1/generation/${encodeURIComponent(p.generationId)}/cancel`,
        { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}` } }
      );
      providerCancel = r.ok ? 'succeeded' : 'failed';
      await cancelBody(r);
    } catch {
      providerCancel = 'failed';
    }
  return jsonResponse({ localAbortRequested: !!local, providerCancel });
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method === 'OPTIONS')
      return withCORS(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return jsonResponse({ status: 'ok', version: '0.2.0' });
    if (url.pathname.startsWith('/api/') && !authenticated(request, env))
      return jsonResponse({ error: 'Unauthorized' }, 401);
    if (url.pathname === '/api/stream' && request.method === 'POST')
      return handleStream(request, env, ctx);
    if (url.pathname === '/api/request' && request.method === 'POST')
      return handleRequest(request);
    if (url.pathname === '/api/moderation' && request.method === 'POST')
      return handleModeration(request);
    if (url.pathname.startsWith('/api/recover/') && request.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/recover/'.length));
      return id
        ? handleRecover(
            id,
            Number.parseInt(url.searchParams.get('lastEventId') ?? '0', 10) ||
              0,
            request,
            ctx
          )
        : jsonResponse({ error: 'sessionId is required' }, 400);
    }
    if (url.pathname.startsWith('/api/ack/') && request.method === 'POST') {
      const id = decodeURIComponent(url.pathname.slice('/api/ack/'.length));
      return id
        ? jsonResponse({
            deleted: await caches.default.delete(
              await cacheKey(id, request.url)
            ),
          })
        : jsonResponse({ error: 'sessionId is required' }, 400);
    }
    if (url.pathname.startsWith('/api/cancel/') && request.method === 'POST') {
      const id = decodeURIComponent(url.pathname.slice('/api/cancel/'.length));
      return id
        ? handleCancel(id, request)
        : jsonResponse({ error: 'sessionId is required' }, 400);
    }
    return jsonResponse({ error: 'Not Found' }, 404);
  },
};
