import useStore from '@store/store';
import type { OpenRouterObservation } from '@type/chat';
/**
 * Client utilities for the Weavelet Stream Proxy (Cloudflare Worker).
 *
 * Provides:
 * - ACK endpoint to delete KV cache after full receipt
 * - Recovery endpoint to replay missed chunks
 * - Proxy SSE event parsing helpers
 */

export interface ProxyConfig {
  /** Base URL of the proxy worker, e.g. "https://stream-proxy.example.com" */
  endpoint: string;
  /** Optional Bearer token for PROXY_AUTH_TOKEN */
  authToken?: string;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

function authHeaders(config: ProxyConfig): Record<string, string> {
  if (!config.authToken) return {};
  return { Authorization: `Bearer ${config.authToken}` };
}

export function getProxyConfig(): ProxyConfig | undefined {
  const { proxyEnabled, proxyEndpoint, proxyAuthToken } = useStore.getState();
  const endpoint = proxyEndpoint?.trim().replace(/\/+$/, '');
  if (!proxyEnabled || !endpoint) return undefined;
  return { endpoint, authToken: proxyAuthToken || undefined };
}

export function fetchViaProxy(
  config: ProxyConfig | undefined,
  endpoint: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(config ? `${config.endpoint}/api/request` : endpoint, {
    method: 'POST',
    headers: config ? { 'Content-Type': 'application/json', ...authHeaders(config) } : headers,
    body: JSON.stringify(config ? { endpoint, headers, body } : body),
    signal,
  });
}

/**
 * Ask the proxy to cancel the upstream LLM stream and optionally
 * forward a provider-level cancel request (e.g. OpenRouter generation cancel).
 *
 * Best-effort — KV TTL will clean up eventually if the request fails.
 */
export interface ProxyCancelResult {
  localAbortRequested: boolean;
  providerCancel: 'not-requested' | 'succeeded' | 'failed';
}

export async function sendCancel(
  config: ProxyConfig,
  sessionId: string,
  providerCancel?: { generationId: string; apiKey: string }
): Promise<ProxyCancelResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `${config.endpoint}/api/cancel/${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(config),
        },
        body: JSON.stringify({ providerCancel }),
        signal: controller.signal,
      }
    );
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return null; }
    return await response.json().catch(() => null);
  } catch {
    // Best-effort — the Worker may have already finished
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Notify the proxy that the client has fully received all chunks.
 * The proxy will delete the KV cache immediately.
 */
export async function sendAck(
  config: ProxyConfig,
  sessionId: string
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `${config.endpoint}/api/ack/${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        headers: authHeaders(config),
        signal: controller.signal,
      }
    );
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return false; }
    return Boolean((await response.json().catch(() => null))?.deleted);
  } catch {
    // Best-effort — KV TTL will clean up eventually
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Recover missed chunks from the proxy's KV cache.
 * Returns the response body as a ReadableStream of proxy SSE, or null on failure.
 */
export async function recoverFromProxy(
  config: ProxyConfig,
  sessionId: string,
  lastEventId: number,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const res = await fetchProxyRecovery(config, sessionId, lastEventId, signal);
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return res.body;
  } catch {
    return null;
  }
}

export function fetchProxyRecovery(
  config: ProxyConfig,
  sessionId: string,
  lastEventId: number,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(
    `${config.endpoint}/api/recover/${encodeURIComponent(sessionId)}?lastEventId=${lastEventId}`,
    { headers: authHeaders(config), signal }
  );
}

export function retryAfterMessage(value: string | null, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 ? `Retry after ${Math.ceil(delay / 1000)} seconds` : undefined;
}

/**
 * Forward a moderation request through the relay worker to avoid browser CORS.
 */
export async function runModerationViaProxy(
  config: ProxyConfig,
  payload: { endpoint: string; apiKey: string; input: string }
): Promise<Response> {
  return fetch(`${config.endpoint}/api/moderation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config),
    },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Proxy SSE parsing
// ---------------------------------------------------------------------------

export interface ProxySseEvent {
  /** Sequential event ID from the proxy */
  id: number;
  /** Event type: undefined for data events, 'done' or 'error' for control */
  eventType?: string;
  /** The raw text chunk from the LLM (for data events) */
  rawText?: string;
  /** Metadata for done/error events */
  meta?: { totalChunks: number; complete: boolean; error?: string; reason?: string; cacheCapability?: 'available' | 'overflow'; openRouterObservation?: OpenRouterObservation };
}

/**
 * Parse proxy SSE text into structured events.
 *
 * IMPORTANT: A plain-JS copy of this function exists in public/sw-stream.js
 * (parseProxySse) for Service Worker scope which cannot import ES modules.
 * Keep both implementations in sync when making changes.
 *
 * Proxy SSE format:
 *   id: 1
 *   data: "JSON-stringified raw text"
 *
 *   event: done
 *   data: {"totalChunks":N,"complete":true}
 */
export function parseProxySse(
  text: string,
  flush = false
): { events: ProxySseEvent[]; partial: string } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawBlocks = normalized.split('\n\n');
  const partial = flush ? '' : (rawBlocks.pop() ?? '');
  const events: ProxySseEvent[] = [];

  for (const block of rawBlocks) {
    if (!block.trim()) continue;

    let id = 0;
    let eventType: string | undefined;
    let dataLine = '';

    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) {
        id = parseInt(line.slice(4), 10);
      } else if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        dataLine = line.slice(6);
      } else if (line === 'data') {
        dataLine = '';
      }
    }

    if (eventType === 'done' || eventType === 'error' || eventType === 'interrupted' || eventType === 'waiting' || eventType === 'cache-miss') {
      try {
        events.push({ id, eventType, meta: JSON.parse(dataLine) });
      } catch {
        events.push({ id, eventType });
      }
    } else if (dataLine) {
      try {
        const rawText = JSON.parse(dataLine) as string;
        events.push({ id, rawText });
      } catch {
        // Malformed data — skip
      }
    }
  }

  return { events, partial };
}
