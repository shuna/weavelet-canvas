import { describe, expect, it } from 'vitest';
import {
  packedKey,
  isPackedKey,
  compressChatRecord,
  decompressChatRecord,
} from './CompressionService';

describe('packedKey / isPackedKey', () => {
  it('appends :packed suffix', () => {
    expect(packedKey('chat:abc')).toBe('chat:abc:packed');
  });

  it('detects packed keys', () => {
    expect(isPackedKey('chat:abc:packed')).toBe(true);
    expect(isPackedKey('chat:abc')).toBe(false);
    expect(isPackedKey('meta')).toBe(false);
  });
});

describe('compressChatRecord / decompressChatRecord', () => {
  it('round-trips a chat record through gzip', async () => {
    const record = {
      chat: {
        id: 'test-123',
        title: 'Hello World',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
        ],
      },
      generation: 5,
    };

    const compressed = await compressChatRecord(record);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.byteLength).toBeGreaterThan(0);

    const decompressed = await decompressChatRecord(compressed);
    expect(decompressed).toEqual(record);
  });

  it('compresses large data smaller than raw JSON', async () => {
    const longText = 'A'.repeat(10000);
    const record = {
      chat: {
        id: 'big',
        title: 'Big Chat',
        messages: Array.from({ length: 50 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: longText }],
        })),
      },
      generation: 1,
    };

    const rawSize = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    const compressed = await compressChatRecord(record);

    // gzip should significantly compress repetitive data
    expect(compressed.byteLength).toBeLessThan(rawSize * 0.5);

    // Verify round-trip
    const decompressed = await decompressChatRecord(compressed);
    expect(decompressed).toEqual(record);
  });

  it('handles empty messages array', async () => {
    const record = {
      chat: { id: 'empty', title: 'Empty', messages: [] },
      generation: 0,
    };

    const compressed = await compressChatRecord(record);
    const decompressed = await decompressChatRecord(compressed);
    expect(decompressed).toEqual(record);
  });
});
