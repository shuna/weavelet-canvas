/**
 * Extended delta compression tests for contentStore.
 * Phase 1 delta compression: addContentDelta, resolveContent, releaseContent, buildExportContentStore.
 */
import { describe, expect, it } from 'vitest';
import {
  ContentStoreData,
  addContent,
  addContentDelta,
  buildExportContentStore,
  resolveContent,
  releaseContent,
  flushPendingGC,
  isDeltaEligible,
} from './contentStore';
import type { ContentInterface } from '@type/chat';

const text = (t: string): ContentInterface[] => [{ type: 'text', text: t }];
const image = (): ContentInterface[] => [
  { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'auto' } },
];

// Long text for delta eligibility
const L = 'This is a fairly long text that simulates a real chat message with enough content to make delta compression worthwhile. It contains multiple sentences.';
const lt = (suffix: string) => text(L + suffix);

describe('addContentDelta Phase 1', () => {
  it('text-only content stores as delta', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(''));
    const hash = addContentDelta(store, lt(' added'), baseHash);
    expect(store[hash].delta).toBeDefined();
    expect(store[hash].delta!.baseHash).toBe(baseHash);
  });

  it('image_url content falls back to full storage', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(''));
    const hash = addContentDelta(store, image(), baseHash);
    expect(store[hash].delta).toBeUndefined();
    expect(store[hash].content).toEqual(image());
  });

  it('high diff ratio falls back to full storage', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, text('aaaa'));
    // Completely different content → patch would be larger than threshold
    const hash = addContentDelta(
      store,
      text('zzzzzzzzzzzzzzzzzzzzzz completely different content entirely'),
      baseHash
    );
    expect(store[hash].delta).toBeUndefined();
  });

  it('chain depth limit triggers full storage fallback', () => {
    const store: ContentStoreData = {};
    let prevHash = addContent(store, lt(''));
    // Build chain of depth 4 (MAX_CHAIN_DEPTH=5, limit is MAX-1=4)
    for (let i = 1; i <= 4; i++) {
      prevHash = addContentDelta(store, lt(` version${i}`), prevHash);
    }
    // Next should be full (depth would be 5)
    const hash = addContentDelta(store, lt(' version5'), prevHash);
    expect(store[hash].delta).toBeUndefined();
    expect(store[hash].content).toEqual(lt(' version5'));
  });
});

describe('resolveContent delta chains', () => {
  it('resolves a depth-4 delta chain correctly', () => {
    const store: ContentStoreData = {};
    let prevHash = addContent(store, lt(''));
    let lastContent: ContentInterface[] = lt('');
    for (let i = 1; i <= 4; i++) {
      lastContent = lt(` v${i}`);
      prevHash = addContentDelta(store, lastContent, prevHash);
    }
    expect(resolveContent(store, prevHash)).toEqual(lastContent);
  });

  it('returns empty array for missing base hash (corruption)', () => {
    const store: ContentStoreData = {
      broken: {
        content: [],
        refCount: 1,
        delta: { baseHash: 'nonexistent', patches: 'invalid' },
      },
    };
    const result = resolveContent(store, 'broken');
    expect(result).toEqual([]);
  });
});

describe('releaseContent delta promotion', () => {
  it('promotes dependent deltas to full when base refCount reaches 0', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(' base'));
    const depHash = addContentDelta(store, lt(' base modified'), baseHash);
    expect(store[depHash].delta).toBeDefined();

    releaseContent(store, baseHash);
    // Dependent should be promoted to full
    expect(store[depHash].delta).toBeUndefined();
    expect(store[depHash].content).toEqual(lt(' base modified'));

    // Base should be pending GC
    expect(store[baseHash].refCount).toBeLessThanOrEqual(0);
    flushPendingGC(store);
    expect(store[baseHash]).toBeUndefined();
  });
});

describe('buildExportContentStore', () => {
  it('resolves all deltas to full content, no delta field in output', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(''));
    const d1Hash = addContentDelta(store, lt(' d1'), baseHash);
    const d2Hash = addContentDelta(store, lt(' d2'), d1Hash);

    const exported = buildExportContentStore(store);

    // All entries should have full content, no delta
    for (const [hash, entry] of Object.entries(exported)) {
      expect(entry.delta).toBeUndefined();
      expect(entry.content.length).toBeGreaterThan(0);
    }
    expect(exported[d1Hash].content).toEqual(lt(' d1'));
    expect(exported[d2Hash].content).toEqual(lt(' d2'));
  });
});
