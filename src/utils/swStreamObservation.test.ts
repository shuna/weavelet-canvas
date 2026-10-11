import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

describe('Service Worker recovery observations', () => {
  it('preserves observations and text when both updates run concurrently', async () => {
    const scope = runInNewContext(`${readFileSync('public/sw-stream.js', 'utf8')}\n({ dbPut, dbGet, dbUpdate })`, {
      indexedDB: new IDBFactory(), self: { addEventListener() {} }, Date, Map,
    });
    await scope.dbPut({ requestId: 'concurrent', bufferedText: '', lastProxyEventId: 0 });
    await Promise.all([
      scope.dbUpdate('concurrent', { bufferedText: 'complete answer', lastProxyEventId: 42 }),
      scope.dbUpdate('concurrent', { openRouterObservation: { cost: 0, cachedTokens: 12 } }),
    ]);
    expect(await scope.dbGet('concurrent')).toMatchObject({
      bufferedText: 'complete answer', lastProxyEventId: 42,
      openRouterObservation: { cost: 0, cachedTokens: 12 },
    });
  });
  it.each(['completed', 'failed'])('keeps %s output in IDB after terminal notification', async (status) => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n'));
      if (status === 'completed') {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    }, pull(controller) {
      if (status === 'failed') controller.error(new Error('network lost'));
    } });
    const scope = runInNewContext(`${readFileSync('public/sw-stream.js', 'utf8')}\n({ handleStartStream, dbGet })`, {
      indexedDB: new IDBFactory(), self: { addEventListener() {} }, Date, Map,
      AbortController, TextDecoder, setTimeout, clearTimeout,
      fetch: async () => new Response(body),
    });
    const messages: any[] = [];
    await scope.handleStartStream({ requestId: 'terminal', chatId: 'chat', nodeId: 'node', endpoint: 'https://example.test', headers: {}, body: {} },
      { postMessage: (message: unknown) => messages.push(message) });
    expect(messages.some(message => message.type === (status === 'completed' ? 'sw-done' : 'sw-error'))).toBe(true);
    expect(await scope.dbGet('terminal')).toMatchObject({ status, bufferedText: 'partial answer', chatId: 'chat', nodeId: 'node' });
  });

});
