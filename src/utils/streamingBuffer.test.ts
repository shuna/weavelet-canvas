import { addContent, resolveContent } from './contentStore';
import type { ChatInterface } from '@type/chat';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  appendReasoningToStreamingBuffer, appendToStreamingBuffer, clearStreamingBuffersForTest, finalizeStreamingBuffer,
  initializeStreamingBuffer, notifyStreamingUpdate, peekBufferedContent, subscribeToStreaming,
  createStreamingContentHash, finalizeStreamingSnapshotState, isBufferingNode,
} from './streamingBuffer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearStreamingBuffersForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('publishes the first chunk immediately and continuous updates at most every 150ms without postponing them', () => {
  initializeStreamingBuffer('chat', 'node', []);
  const displayed: string[] = [];
  const unsubscribe = subscribeToStreaming('chat', 'node', () => displayed.push((peekBufferedContent('chat', 'node')![0] as { text: string }).text));
  for (let i = 0; i < 10; i++) {
    appendToStreamingBuffer('chat', 'node', String(i));
    notifyStreamingUpdate('chat', 'node');
    vi.advanceTimersByTime(20);
  }
  expect(displayed).toEqual(['0', '01234567']);
  expect((finalizeStreamingBuffer('chat', 'node')[0] as { text: string }).text).toBe('0123456789');
  vi.runAllTimers();
  expect(displayed).toHaveLength(2);
  unsubscribe();
});

it('keeps receiving while hidden and publishes the latest text when visible again', () => {
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', document);
  initializeStreamingBuffer('chat', 'node', []);
  const listener = vi.fn();
  const unsubscribe = subscribeToStreaming('chat', 'node', listener);
  appendToStreamingBuffer('chat', 'node', 'first');
  notifyStreamingUpdate('chat', 'node');
  appendToStreamingBuffer('chat', 'node', ' pending');
  notifyStreamingUpdate('chat', 'node');
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  appendToStreamingBuffer('chat', 'node', ' hidden');
  notifyStreamingUpdate('chat', 'node');
  vi.advanceTimersByTime(1000);
  expect(listener).toHaveBeenCalledTimes(1);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(listener).toHaveBeenCalledTimes(2);
  expect((peekBufferedContent('chat', 'node')![0] as { text: string }).text).toBe('first pending hidden');
  unsubscribe();
  notifyStreamingUpdate('chat', 'node');
  expect(vi.getTimerCount()).toBe(0);
});

it('separates 150ms body and 250ms reasoning deadlines and only announces collapsed reasoning once', () => {
  initializeStreamingBuffer('chat', 'node', []);
  const body = vi.fn(), reasoning = vi.fn(), collapsed = vi.fn();
  const unsubscribe = [
    subscribeToStreaming('chat', 'node', body),
    subscribeToStreaming('chat', 'node', reasoning, 250, true),
    subscribeToStreaming('chat', 'node', collapsed, 250, true, true),
  ];
  appendReasoningToStreamingBuffer('chat', 'node', 'first');
  notifyStreamingUpdate('chat', 'node');
  expect(body).not.toHaveBeenCalled();
  expect(reasoning).toHaveBeenCalledTimes(1);
  expect(collapsed).toHaveBeenCalledTimes(1);
  appendToStreamingBuffer('chat', 'node', 'first');
  notifyStreamingUpdate('chat', 'node');
  expect(body).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(50);
  appendToStreamingBuffer('chat', 'node', ' next');
  appendReasoningToStreamingBuffer('chat', 'node', ' next');
  notifyStreamingUpdate('chat', 'node');
  vi.advanceTimersByTime(100);
  expect(body).toHaveBeenCalledTimes(2);
  expect(reasoning).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(100);
  expect(reasoning).toHaveBeenCalledTimes(2);
  expect(collapsed).toHaveBeenCalledTimes(1);
  unsubscribe.forEach(stop => stop());
  expect(vi.getTimerCount()).toBe(0);
});


it('isolates content, notification and finalization for cloned node IDs', () => {
  initializeStreamingBuffer('original', 'node', []);
  initializeStreamingBuffer('clone', 'node', []);
  const original = vi.fn(), clone = vi.fn();
  const offOriginal = subscribeToStreaming('original', 'node', original);
  const offClone = subscribeToStreaming('clone', 'node', clone);
  appendToStreamingBuffer('original', 'node', 'one');
  notifyStreamingUpdate('original', 'node');
  expect(original).toHaveBeenCalledTimes(1);
  expect(clone).not.toHaveBeenCalled();
  appendToStreamingBuffer('clone', 'node', 'two');
  expect(resolveContent({}, createStreamingContentHash('original', 'node'))).toEqual([{ type: 'text', text: 'one' }]);
  expect(resolveContent({}, createStreamingContentHash('clone', 'node'))).toEqual([{ type: 'text', text: 'two' }]);
  finalizeStreamingBuffer('original', 'node');
  expect(isBufferingNode('clone', 'node')).toBe(true);
  offOriginal(); offClone();
});

it('snapshots existing content without changing live refcounts or consuming the buffer', () => {
  const content = [{ type: 'text' as const, text: 'same' }];
  const contentStore = {};
  const hash = addContent(contentStore, content);
  initializeStreamingBuffer('chat', 'node', content);
  const chat = { id: 'chat', title: 'chat', titleSet: true, imageDetail: 'auto', config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 }, messages: [], branchTree: { rootId: 'node', activePath: ['node'], nodes: { node: { id: 'node', parentId: null, role: 'assistant', createdAt: 1, contentHash: createStreamingContentHash('chat', 'node') } } } } as ChatInterface;
  const before = structuredClone(contentStore);
  const snapshot = finalizeStreamingSnapshotState([chat], contentStore);
  expect(contentStore).toEqual(before);
  expect(snapshot.chats![0].branchTree!.nodes.node.contentHash).toBe(hash);
  expect(isBufferingNode('chat', 'node')).toBe(true);
});
