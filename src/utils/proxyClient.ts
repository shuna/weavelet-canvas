import useStore from '@store/store';
import { proxyStatusRequest, readProxyStatus, proxyDeleteRequest, readProxyDeletion, type ProxyDeletionState } from './proxyManagement';
import type { ProxyStatus } from '../../proxy-worker/src/diagnostics';
export type { ProxyStatus } from '../../proxy-worker/src/diagnostics';
/**
 * Client utilities for the Weavelet Stream Proxy (Cloudflare Worker).
 *
 * Provides:
 * - ACK endpoint to delete recovery data after full receipt
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

export async function fetchProxyStatus(config: ProxyConfig, sessionIds: string[], signal?: AbortSignal, page?: { all: true; cursor?: string }): Promise<ProxyStatus> {
  const request = proxyStatusRequest({ sessionIds, ...page });
  const response = await fetch(`${config.endpoint.trim().replace(/\/+$/, '')}${request.path}?${new URLSearchParams(request.query)}`, {
    headers: authHeaders(config), cache: 'no-store', signal,
  });
  if (!response.ok) await response.body?.cancel().catch(() => {});
  return readProxyStatus(response.status, response.ok ? await response.json() : undefined, page?.all);
}

export async function deleteProxyStorage(config: ProxyConfig, sessionId?: string): Promise<number> {
  const base = config.endpoint.trim().replace(/\/+$/, '');
  let state: ProxyDeletionState | undefined;
  do {
    const request = proxyDeleteRequest(sessionId, state);
    const query = new URLSearchParams(request.query);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), request.timeout * 1000);
    try {
      const response = await fetch(`${base}${request.path}${sessionId === undefined ? `?${query}` : ''}`, {
        method: request.method, headers: authHeaders(config), cache: 'no-store', signal: abort.signal,
      });
      if (!response.ok) await response.body?.cancel().catch(() => {});
      state = readProxyDeletion(response.status, response.ok ? await response.json() : undefined, sessionId, state);
    } finally { clearTimeout(timer); }
  } while (state.cursor);
  return state.deleted;
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
 * The proxy will delete recovery data immediately.
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
  payload: { endpoint: string; apiKey: string; input: string },
  signal?: AbortSignal
): Promise<Response> {
  return fetch(`${config.endpoint}/api/moderation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config),
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export { parseProxySse, type ProxySseEvent } from './proxyProtocol';
