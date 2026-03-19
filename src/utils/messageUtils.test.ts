import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageInterface } from '@type/chat';
import {
  countTokens,
  isEncoderReady,
  onEncoderReady,
  resetTokenizerWorkerForTests,
} from './messageUtils';

class ErroringWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  postMessage() {
    queueMicrotask(() => {
      this.onerror?.(new Event('error'));
    });
  }

  terminate() {}
}

class ZeroCountWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  postMessage(message: { type: string; id: number }) {
    queueMicrotask(() => {
      if (message.type === 'init') {
        this.onmessage?.({ data: { id: message.id, type: 'ready' } } as MessageEvent);
        return;
      }
      if (message.type === 'countTokens') {
        this.onmessage?.({
          data: { id: message.id, type: 'countTokensResult', count: 0 },
        } as MessageEvent);
      }
    });
  }

  terminate() {}
}

beforeEach(() => {
  resetTokenizerWorkerForTests();
});

describe('countTokens fallback', () => {
  it('returns a non-zero estimate when the worker is unavailable', async () => {
    vi.stubGlobal('Worker', ErroringWorker);

    const messages: MessageInterface[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello, this is a test message' }],
      },
    ];

    const count = await countTokens(messages, 'gpt-4o');
    expect(count).toBeGreaterThan(0);
  });

  it('falls back to a character-based estimate when the worker reports zero for saved text', async () => {
    vi.stubGlobal('Worker', ZeroCountWorker);

    const messages: MessageInterface[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '保存済みのテキストは0トークンにならない' }],
      },
    ];

    const count = await countTokens(messages, 'gpt-4o');
    expect(count).toBeGreaterThan(0);
  });

  it('onEncoderReady fires callback when worker becomes unavailable', async () => {
    vi.stubGlobal('Worker', ErroringWorker);

    // Initially not ready
    expect(isEncoderReady()).toBe(false);

    // Register listener
    let called = false;
    onEncoderReady(() => { called = true; });

    // Trigger worker init (will error and mark unavailable)
    const messages: MessageInterface[] = [
      { role: 'user', content: [{ type: 'text', text: 'test' }] },
    ];
    await countTokens(messages, 'gpt-4o');

    // After worker failure, isEncoderReady should be true (unavailable)
    expect(isEncoderReady()).toBe(true);
    // And the callback should have been called
    expect(called).toBe(true);
  });

  it('onEncoderReady fires immediately if already unavailable', () => {
    vi.stubGlobal('Worker', ErroringWorker);

    // Simulate already-unavailable state by running a count first
    // We need to make it unavailable first
    const p = countTokens(
      [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      'gpt-4o'
    );

    return p.then(() => {
      expect(isEncoderReady()).toBe(true);

      let called = false;
      onEncoderReady(() => { called = true; });
      expect(called).toBe(true);
    });
  });

  it('counts longer text higher than shorter text in fallback mode', async () => {
    vi.stubGlobal('Worker', ErroringWorker);

    const shortMessage: MessageInterface[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'short text' }],
      },
    ];
    const longMessage: MessageInterface[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'long text '.repeat(20) }],
      },
    ];

    const [shortCount, longCount] = await Promise.all([
      countTokens(shortMessage, 'gpt-4o'),
      countTokens(longMessage, 'gpt-4o'),
    ]);

    expect(shortCount).toBeGreaterThan(0);
    expect(longCount).toBeGreaterThan(shortCount);
  });
});
