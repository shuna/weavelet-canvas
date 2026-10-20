import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const bytes = (parts: string[]) => new ReadableStream<Uint8Array>({
  start(controller) { parts.forEach((part) => controller.enqueue(new TextEncoder().encode(part))); controller.close(); },
});

async function run(parts: string[], stall = false, onStart?: (scope: any) => void) {
  const messages: any[] = [];
  const scope = runInNewContext(`${readFileSync('public/sw-stream.js', 'utf8')}\n({ handleStartStream, dbGet })`, {
    indexedDB: new IDBFactory(), self: { addEventListener() {} }, Date, Map, Promise,
    TextEncoder, TextDecoder, ReadableStream, AbortController, setTimeout, clearTimeout,
    console: { log() {} }, fetch: async () => new Response(stall ? new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(new TextEncoder().encode(part))); } }) : bytes(parts), { status: 200 }),
  });
  const pending = scope.handleStartStream({ requestId: 'r', chatId: 'c', nodeId: 'n', endpoint: 'https://llm', headers: {}, body: {}, chatIndex: 0, messageIndex: 0,
    proxyMode: true, proxyConfig: { endpoint: 'https://proxy', sessionId: 's' } }, { postMessage: (message: any) => messages.push(message) });
  onStart?.(scope);
  await pending;
  return { messages, record: await scope.dbGet('r') };
}

describe('SW proxy stream terminal and checkpoint semantics', () => {
  it('requires nested DONE and outer done, retaining split think parser state until success', async () => {
    const raw = 'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\ndata: {"choices":[{"delta":{"content":"nk>why</think>ok"}}]}\n\ndata: [DONE]\n\n';
    const outer = `id: 1\ndata: ${JSON.stringify(raw)}\n\nevent: done\ndata: {"complete":true}\n\n`;
    const { messages, record } = await run([outer.slice(0, 25), outer.slice(25)]);
    expect(messages.some((message) => message.type === 'sw-done')).toBe(true);
    expect(messages.filter((message) => message.type === 'sw-chunk')).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '', reasoning: 'why' }), expect.objectContaining({ text: 'ok' }),
    ]));
    expect(record).toMatchObject({ bufferedText: 'ok', bufferedReasoning: 'why', lastProxyEventId: 1, llmSsePartial: '' });
  });

  it('keeps the recovery record and does not emit done when outer EOF follows inner DONE', async () => {
    const raw = 'data: [DONE]\n\n';
    const outer = `id: 1\ndata: ${JSON.stringify(raw)}\n\n`;
    const { messages, record } = await run([outer]);
    expect(messages.some((message) => message.type === 'sw-done')).toBe(false);
    expect(messages.some((message) => message.type === 'sw-error')).toBe(true);
    expect(record).toMatchObject({ status: 'failed', lastProxyEventId: 1 });
  });
  it('retains the same proxy ID and parser checkpoint after a 45-second chunk timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const raw = 'data: {"choices":[{"delta":{"content":"A<thi"}}]}\n\n';
      const pending = run([`id: 1\ndata: ${JSON.stringify(raw)}\n\n`], true);
      // IndexedDB uses real tasks; wait until the first read schedules its timeout.
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
      await vi.advanceTimersByTimeAsync(45_001);
      const { messages, record } = await pending;
      expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'sw-error', error: 'Chunk timeout: no data received for 45s' })]));
      expect(record).toMatchObject({ chatId: 'c', nodeId: 'n', proxySessionId: 's', status: 'failed', bufferedText: 'A', lastProxyEventId: 1, thinkTagCheckpoint: { state: 'outside', pending: '<thi' } });
    } finally { vi.useRealTimers(); }
  });

});

it('does not advance the persisted event ID when EOF cuts an outer SSE frame before its delimiter', async () => {
  const raw = 'data: {"choices":[{"delta":{"content":"must replay"}}]}\n\n';
  const { record, messages } = await run([`id: 1\ndata: ${JSON.stringify(raw)}`]);
  expect(record).toMatchObject({ status: 'failed', lastProxyEventId: 0, bufferedText: '' });
  expect(messages.some(message => message.type === 'sw-done')).toBe(false);
});

it('checkpoints reasoning-only events before any display text or terminal response arrives', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    let scope: any;
    const raw = 'data: {"choices":[{"delta":{"reasoning":"still thinking"}}]}\n\n';
    const pending = run([`id: 1\ndata: ${JSON.stringify(raw)}\n\n`], true, value => { scope = value; });
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(801);
    await vi.waitFor(async () => expect(await scope.dbGet('r')).toMatchObject({ bufferedText: '', bufferedReasoning: 'still thinking', lastProxyEventId: 1, status: 'streaming' }));
    await vi.advanceTimersByTimeAsync(45_001);
    await pending;
  } finally { vi.useRealTimers(); }
});
