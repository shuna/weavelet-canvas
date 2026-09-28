import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@store/debug-store', () => ({ debugReport: vi.fn() }));
vi.mock('./streamDb', () => ({
  saveRequest: vi.fn().mockResolvedValue(undefined),
  cleanupStale: vi.fn().mockResolvedValue(undefined),
}));

class TestPort {
  peer: TestPort | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  postMessage(data: unknown) {
    if (!this.closed && this.peer && !this.peer.closed) {
      this.peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

class TestMessageChannel {
  port1 = new TestPort();
  port2 = new TestPort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

class TestDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

describe('Service Worker stream heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'MessageChannel', {
      value: TestMessageChannel,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: new TestDocument(),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the original worker alive and stops heartbeats after completion', async () => {
    const messages: Array<{ message: Record<string, unknown>; ports: TestPort[] }> = [];
    let streamPort: TestPort | undefined;
    const controller = {
      postMessage: vi.fn((message: Record<string, unknown>, ports: TestPort[] = []) => {
        messages.push({ message, ports });
        if (message.type === 'startStream') streamPort = ports[0];
        if (message.type === 'keepStreamAlive') {
          ports[0].postMessage({
            type: 'sw-heartbeat-ack',
            requestId: message.requestId,
            active: true,
          });
        }
      }),
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker: { controller } },
      configurable: true,
    });

    const { startStream } = await import('./swBridge');
    const onDone = vi.fn();
    await startStream({
      requestId: 'request-1',
      endpoint: 'https://example.test/chat',
      headers: {},
      body: {},
      chatIndex: 0,
      messageIndex: 1,
      onChunk: vi.fn(),
      onDone,
      onError: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(messages.filter(({ message }) => message.type === 'keepStreamAlive')).toHaveLength(1);

    streamPort?.postMessage({ type: 'sw-done', requestId: 'request-1', finishReason: 'stop' });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ finishReason: 'stop' }));

    await vi.advanceTimersByTimeAsync(20_000);
    expect(messages.filter(({ message }) => message.type === 'keepStreamAlive')).toHaveLength(1);
  });

  it('cancels through the worker that started the stream', async () => {
    const originalController = { postMessage: vi.fn() };
    const replacementController = { postMessage: vi.fn() };
    const serviceWorker = { controller: originalController };
    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker },
      configurable: true,
    });

    const { startStream } = await import('./swBridge');
    const handle = await startStream({
      requestId: 'request-2',
      endpoint: 'https://example.test/chat',
      headers: {},
      body: {},
      chatIndex: 0,
      messageIndex: 1,
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });

    serviceWorker.controller = replacementController;
    handle.cancel();

    expect(originalController.postMessage).toHaveBeenCalledWith({
      type: 'cancelStream',
      requestId: 'request-2',
    });
    expect(replacementController.postMessage).not.toHaveBeenCalled();
  });
});
