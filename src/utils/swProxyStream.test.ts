import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const bytes = (parts: string[]) => new ReadableStream<Uint8Array>({
  start(controller) { parts.forEach((part) => controller.enqueue(new TextEncoder().encode(part))); controller.close(); },
});

async function run(parts: string[]) {
  const messages: any[] = [];
  const scope = runInNewContext(`${readFileSync('public/sw-stream.js', 'utf8')}\n({ handleStartStream, dbGet })`, {
    indexedDB: new IDBFactory(), self: { addEventListener() {} }, Date, Map, Promise,
    TextEncoder, TextDecoder, ReadableStream, AbortController, setTimeout, clearTimeout,
    console: { log() {} }, fetch: async () => new Response(bytes(parts), { status: 200 }),
  });
  await scope.handleStartStream({ requestId: 'r', endpoint: 'https://llm', headers: {}, body: {}, chatIndex: 0, messageIndex: 0,
    proxyMode: true, proxyConfig: { endpoint: 'https://proxy', sessionId: 's' } }, { postMessage: (message: any) => messages.push(message) });
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
});
