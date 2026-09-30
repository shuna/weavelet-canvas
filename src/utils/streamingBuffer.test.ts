import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  appendReasoningToStreamingBuffer, appendToStreamingBuffer, clearStreamingBuffersForTest, finalizeStreamingBuffer,
  initializeStreamingBuffer, notifyStreamingUpdate, peekBufferedContent, subscribeToStreaming,
} from './streamingBuffer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearStreamingBuffersForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('publishes the first chunk immediately and continuous updates at most every 150ms without postponing them', () => {
  initializeStreamingBuffer('node', []);
  const displayed: string[] = [];
  const unsubscribe = subscribeToStreaming('node', () => displayed.push((peekBufferedContent('node')![0] as { text: string }).text));
  for (let i = 0; i < 10; i++) {
    appendToStreamingBuffer('node', String(i));
    notifyStreamingUpdate('node');
    vi.advanceTimersByTime(20);
  }
  expect(displayed).toEqual(['0', '01234567']);
  expect((finalizeStreamingBuffer('node')[0] as { text: string }).text).toBe('0123456789');
  vi.runAllTimers();
  expect(displayed).toHaveLength(2);
  unsubscribe();
});

it('keeps receiving while hidden and publishes the latest text when visible again', () => {
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', document);
  initializeStreamingBuffer('node', []);
  const listener = vi.fn();
  const unsubscribe = subscribeToStreaming('node', listener);
  appendToStreamingBuffer('node', 'first');
  notifyStreamingUpdate('node');
  appendToStreamingBuffer('node', ' pending');
  notifyStreamingUpdate('node');
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  appendToStreamingBuffer('node', ' hidden');
  notifyStreamingUpdate('node');
  vi.advanceTimersByTime(1000);
  expect(listener).toHaveBeenCalledTimes(1);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(listener).toHaveBeenCalledTimes(2);
  expect((peekBufferedContent('node')![0] as { text: string }).text).toBe('first pending hidden');
  unsubscribe();
  notifyStreamingUpdate('node');
  expect(vi.getTimerCount()).toBe(0);
});

it('separates 150ms body and 250ms reasoning deadlines and only announces collapsed reasoning once', () => {
  initializeStreamingBuffer('node', []);
  const body = vi.fn(), reasoning = vi.fn(), collapsed = vi.fn();
  const unsubscribe = [
    subscribeToStreaming('node', body),
    subscribeToStreaming('node', reasoning, 250, true),
    subscribeToStreaming('node', collapsed, 250, true, true),
  ];
  appendReasoningToStreamingBuffer('node', 'first');
  notifyStreamingUpdate('node');
  expect(body).not.toHaveBeenCalled();
  expect(reasoning).toHaveBeenCalledTimes(1);
  expect(collapsed).toHaveBeenCalledTimes(1);
  appendToStreamingBuffer('node', 'first');
  notifyStreamingUpdate('node');
  expect(body).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(50);
  appendToStreamingBuffer('node', ' next');
  appendReasoningToStreamingBuffer('node', ' next');
  notifyStreamingUpdate('node');
  vi.advanceTimersByTime(100);
  expect(body).toHaveBeenCalledTimes(2);
  expect(reasoning).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(100);
  expect(reasoning).toHaveBeenCalledTimes(2);
  expect(collapsed).toHaveBeenCalledTimes(1);
  unsubscribe.forEach(stop => stop());
  expect(vi.getTimerCount()).toBe(0);
});
