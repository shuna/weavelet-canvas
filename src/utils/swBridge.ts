import type { OpenRouterObservation } from '@type/chat';
import { debugReport } from '@store/debug-store';
import { saveRequest, cleanupStale } from './streamDb';

let registration: ServiceWorkerRegistration | null = null;
let controllerReady: Promise<void> | null = null;

// Firefox may terminate a Service Worker roughly a minute after the event that
// started a long-running stream, even while the event's waitUntil() promise is
// still pending. A fresh window -> Service Worker message resets that lifetime.
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_ACK_TIMEOUT_MS = 4_000;
const MAX_MISSED_HEARTBEATS = 2;

const formatDebugTime = (time = Date.now()): string =>
  new Date(time).toISOString().slice(11, 23);

export async function register(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  debugReport('sw', { label: 'Service Worker', status: 'active', detail: 'registering' });
  try {
    registration = await navigator.serviceWorker.register('./sw-stream.js', {
      scope: './',
    });

    // If no controller yet (first install), wait for it to claim
    if (!navigator.serviceWorker.controller) {
      controllerReady = new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          resolve();
        }, { once: true });
      });
    }

    // Cleanup stale IndexedDB records on startup
    cleanupStale().catch(() => {});
    debugReport('sw', { status: 'done', detail: 'registered' });
    return true;
  } catch {
    debugReport('sw', { status: 'error', detail: 'registration failed' });
    return false;
  }
}

export function isAvailable(): boolean {
  return !!(
    'serviceWorker' in navigator && navigator.serviceWorker.controller
  );
}

export async function waitForController(): Promise<boolean> {
  if (isAvailable()) return true;
  if (controllerReady) {
    await controllerReady;
    return isAvailable();
  }
  return false;
}

export interface SwStreamHandle {
  cancel: () => void;
}

export interface ProxyStreamConfig {
  endpoint: string;
  authToken?: string;
  sessionId: string;
}

export interface StartStreamParams {
  requestId: string;
  endpoint: string;
  headers: Record<string, string>;
  body: object;
  chatIndex: number;
  messageIndex: number;
  onChunk: (text: string, meta?: { generationId?: string; reasoning?: string; openRouterObservation?: OpenRouterObservation }) => void;
  onDone: (meta?: { proxySessionId?: string; lastProxyEventId?: number; generationId?: string; finishReason?: string; openRouterObservation?: OpenRouterObservation }) => void;
  onError: (error: string, meta?: { proxySessionId?: string; lastProxyEventId?: number; generationId?: string; openRouterObservation?: OpenRouterObservation }) => void;
  /** When set, SW routes the request through the proxy worker */
  proxyConfig?: ProxyStreamConfig;
}

export async function startStream(params: StartStreamParams): Promise<SwStreamHandle> {
  const {
    requestId,
    endpoint,
    headers,
    body,
    chatIndex,
    messageIndex,
    onChunk,
    onDone,
    onError,
    proxyConfig,
  } = params;

  debugReport('streaming', { label: 'Streaming', status: 'active', detail: requestId });
  debugReport(`stream:${requestId}`, {
    label: 'SW Stream',
    status: 'active',
    detail: `${formatDebugTime()} start`,
  });
  // Save initial record to IndexedDB (client side too, in case SW dies before writing)
  await saveRequest({
    requestId,
    chatIndex,
    messageIndex,
    bufferedText: '',
    status: 'streaming',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    acknowledged: false,
  });

  const sw = navigator.serviceWorker;

  // Use a dedicated MessageChannel so responses travel over a private port,
  // immune to interference from browser extensions listening on
  // navigator.serviceWorker.onmessage.
  const channel = new MessageChannel();
  let cleanedUp = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let missedHeartbeats = 0;
  const heartbeatChannels = new Set<MessageChannel>();
  const heartbeatTimeouts = new Set<ReturnType<typeof setTimeout>>();

  const controller = sw.controller;
  if (!controller) {
    channel.port1.close();
    throw new Error('Service Worker controller not available');
  }

  const failHeartbeat = (reason: string) => {
    if (cleanedUp) return;
    debugReport(`stream:${requestId}`, {
      status: 'error',
      detail: `${formatDebugTime()} heartbeat failed: ${reason}`,
    });
    cleanup();
    onError(`Service Worker stream lost: ${reason}`);
  };

  const sendHeartbeat = () => {
    if (cleanedUp) return;

    const heartbeatChannel = new MessageChannel();
    heartbeatChannels.add(heartbeatChannel);
    let settled = false;

    const dispose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      heartbeatTimeouts.delete(timeout);
      heartbeatChannels.delete(heartbeatChannel);
      heartbeatChannel.port1.close();
    };

    const timeout = setTimeout(() => {
      dispose();
      missedHeartbeats += 1;
      if (missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
        failHeartbeat('heartbeat acknowledgement timed out');
      }
    }, HEARTBEAT_ACK_TIMEOUT_MS);
    heartbeatTimeouts.add(timeout);

    heartbeatChannel.port1.onmessage = (event: MessageEvent) => {
      if (settled) return;
      const data = event.data;
      dispose();
      if (
        !data ||
        data.type !== 'sw-heartbeat-ack' ||
        data.requestId !== requestId ||
        data.active !== true
      ) {
        failHeartbeat('stream is no longer active in the Service Worker');
        return;
      }
      missedHeartbeats = 0;
    };

    try {
      controller.postMessage(
        { type: 'keepStreamAlive', requestId },
        [heartbeatChannel.port2]
      );
    } catch (error) {
      dispose();
      failHeartbeat(error instanceof Error ? error.message : String(error));
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') sendHeartbeat();
  };

  channel.port1.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data) return;

    switch (data.type) {
      case 'sw-debug':
        debugReport(`sw-pipeline:${requestId}`, {
          label: 'SW Pipeline',
          status: data.status || 'active',
          detail: data.detail,
        });
        break;
      case 'sw-chunk':
        onChunk(data.text, { generationId: data.generationId, reasoning: data.reasoning, openRouterObservation: data.openRouterObservation });
        break;
      case 'sw-done':
        cleanup();
        debugReport('streaming', { status: 'done' });
        debugReport(`stream:${requestId}`, {
          status: 'done',
          detail: `${formatDebugTime()} sw-done`,
        });
        debugReport(`sw-pipeline:${requestId}`, {
          label: 'SW Pipeline',
          status: 'done',
          detail: `${formatDebugTime()} sw-done delivered`,
        });
        onDone({
          proxySessionId: data.proxySessionId,
          lastProxyEventId: data.lastProxyEventId,
          generationId: data.generationId,
          openRouterObservation: data.openRouterObservation,
          finishReason: data.finishReason,
        });
        break;
      case 'sw-error':
        cleanup();
        debugReport('streaming', { status: 'error', detail: data.error });
        debugReport(`stream:${requestId}`, {
          status: 'error',
          detail: `${formatDebugTime()} sw-error ${data.error || 'unknown'}`,
        });
        debugReport(`sw-pipeline:${requestId}`, {
          label: 'SW Pipeline',
          status: 'error',
          detail: `${formatDebugTime()} sw-error delivered`,
        });
        onError(data.error || 'Unknown error', {
          proxySessionId: data.proxySessionId,
          lastProxyEventId: data.lastProxyEventId,
          generationId: data.generationId,
          openRouterObservation: data.openRouterObservation,
        });
        break;
      case 'sw-cancelled':
        cleanup();
        debugReport('streaming', {
          label: 'Streaming',
          status: 'done',
          detail: requestId,
        });
        debugReport(`stream:${requestId}`, {
          status: 'done',
          detail: `${formatDebugTime()} sw-cancelled`,
        });
        debugReport(`sw-pipeline:${requestId}`, {
          label: 'SW Pipeline',
          status: 'done',
          detail: `${formatDebugTime()} sw-cancelled delivered`,
        });
        break;
    }
  };

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    for (const timeout of heartbeatTimeouts) clearTimeout(timeout);
    heartbeatTimeouts.clear();
    for (const heartbeatChannel of heartbeatChannels) {
      heartbeatChannel.port1.close();
    }
    heartbeatChannels.clear();
    channel.port1.close();
  }

  // Send startStream to SW with port2 transferred
  controller.postMessage(
    {
      type: 'startStream',
      requestId,
      endpoint,
      headers,
      body,
      chatIndex,
      messageIndex,
      proxyMode: !!proxyConfig,
      proxyConfig: proxyConfig || undefined,
    },
    [channel.port2],
  );

  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return {
    cancel: () => {
      debugReport(`stream:${requestId}`, {
        label: 'SW Stream',
        status: 'done',
        detail: `${formatDebugTime()} cancel requested`,
      });
      debugReport(`sw-pipeline:${requestId}`, {
        label: 'SW Pipeline',
        status: 'done',
        detail: `${formatDebugTime()} cancel requested`,
      });
      debugReport('streaming', {
        label: 'Streaming',
        status: 'done',
        detail: requestId,
      });
      controller.postMessage({
        type: 'cancelStream',
        requestId,
      });
      cleanup();
    },
  };
}
