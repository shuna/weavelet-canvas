import { afterEach, expect, it, vi } from 'vitest';
import { diff_match_patch } from 'diff-match-patch';
import { addContent, addContentDelta, computeContentHash, resolveContentStrict, type ContentStoreData } from '@utils/contentStore';
import type { BranchNode, ChatInterface, ContentInterface } from '@type/chat';
import { _defaultChatConfig } from '@constants/chat';
import * as cryptoHelpers from './crypto';
import { fromRecords, toRecords, type Snapshot } from './records';

const text = (value: string): ContentInterface[] => [{ type: 'text', text: value }];
const longText = (suffix = '') => text('synthetic delta fixture '.repeat(50) + suffix);
const node = (id: string, contentHash: string, parentId: string | null = null): BranchNode =>
  ({ id, contentHash, parentId, role: 'assistant', createdAt: 1 });
const snapshot = (contentStore: ContentStoreData, hashes: string[], clipboardHash?: string): Snapshot => ({
  version: 18,
  state: {
    contentStore,
    chats: [{ id: 'chat', title: 'fixture', messages: [], titleSet: true, imageDetail: 'auto', config: _defaultChatConfig,
      branchTree: { rootId: 'n0', activePath: ['n0'],
        nodes: Object.fromEntries(hashes.map((hash, i) => [`n${i}`, node(`n${i}`, hash, i ? 'n0' : null)])) },
    } as ChatInterface],
    branchClipboard: clipboardHash ? { sourceChat: 'chat', nodeIds: ['clipboard'], nodes: { clipboard: node('clipboard', clipboardHash) } } : null,
  },
});
const hashes = (value: Snapshot) => Object.values(value.state.chats![0].branchTree!.nodes).map(n => n.contentHash);

afterEach(() => vi.restoreAllMocks());

it('verifies and registers shared content and images once, including clipboard references', async () => {
  const source: ContentStoreData = {};
  const image: ContentInterface = { type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj', detail: 'auto' } };
  const first = addContent(source, [...text('first fixture'), image]);
  const second = addContent(source, [...text('second fixture'), image]);
  const records = await toRecords(snapshot(source, [first, first, second, second], first));
  const spy = vi.spyOn(cryptoHelpers, 'digest');
  const restored = await fromRecords(records);
  expect(spy).toHaveBeenCalledTimes(3); // Two content IDs and one shared image ID.
  const store = restored.state.contentStore!;
  const [one, , two] = hashes(restored);
  expect(Object.keys(store)).toHaveLength(2);
  expect(store[one].refCount).toBe(3);
  expect(store[two].refCount).toBe(2);
  expect(resolveContentStrict(store, one)).toEqual(source[first].content);
  spy.mockRestore();
  expect(await toRecords(restored)).toEqual(records);
});

it('preserves shared delta bases and reconstructs reference counts without mutating the previous store', async () => {
  const previous: ContentStoreData = {};
  const base = addContent(previous, longText());
  const left = addContentDelta(previous, longText(' left'), base);
  const right = addContentDelta(previous, longText(' right'), base);
  expect(previous[left].delta).toBeDefined();
  expect(previous[right].delta).toBeDefined();
  for (const entry of Object.values(previous)) entry.refCount = 100;
  const before = structuredClone(previous);
  const records = await toRecords(snapshot(previous, [left, left, right, base], left));
  const restored = await fromRecords(records, previous);
  const store = restored.state.contentStore!;
  expect(hashes(restored)).toEqual([left, left, right, base]);
  expect(store[left].delta).toEqual(previous[left].delta);
  expect(store[right].delta).toEqual(previous[right].delta);
  expect(store[left].refCount).toBe(3);
  expect(store[right].refCount).toBe(1);
  expect(store[base].refCount).toBe(1);
  expect(store[base]).not.toBe(previous[base]);
  expect(store[left].delta).not.toBe(previous[left].delta);
  expect(previous).toEqual(before);
  expect(await toRecords(restored)).toEqual(records);
});

it.each(['missing', 'cycle', 'patch', 'mismatch'])('uses verified remote full content when the previous delta has %s damage', async mode => {
  const previous: ContentStoreData = {};
  const base = addContent(previous, longText());
  const target = longText(' edited');
  const hash = addContentDelta(previous, target, base);
  const records = await toRecords(snapshot(previous, [hash, hash]));
  if (mode === 'missing') delete previous[base];
  if (mode === 'cycle') previous[hash].delta!.baseHash = hash;
  if (mode === 'patch') previous[hash].delta!.patches = 'invalid patch';
  if (mode === 'mismatch') previous[base].content = longText(' unrelated base');
  const before = structuredClone(previous);
  const restored = await fromRecords(records, previous);
  const store = restored.state.contentStore!;
  const [local] = hashes(restored);
  expect(store[local].delta).toBeUndefined();
  expect(store[local].refCount).toBe(2);
  expect(resolveContentStrict(store, local)).toEqual(target);
  expect(previous).toEqual(before);
  expect(await toRecords(restored)).toEqual(records);
});

it('handles real FNV collisions without merging distinct bodies or losing a reusable suffixed delta', async () => {
  const previous: ContentStoreData = {};
  const first = text('fixture-10365'), second = text('fixture-62335');
  expect(computeContentHash(first)).toBe(computeContentHash(second));
  const collision = addContent(previous, first);
  const base = addContent(previous, longText());
  const suffixed = collision + '_';
  const dmp = new diff_match_patch();
  previous[suffixed] = { content: [], refCount: 55, delta: { baseHash: base,
    patches: dmp.patch_toText(dmp.patch_make(JSON.stringify(previous[base].content), JSON.stringify(second))) } };
  const before = structuredClone(previous);
  const records = await toRecords(snapshot(previous, [collision, suffixed, suffixed], suffixed));
  const restored = await fromRecords(records, previous);
  const store = restored.state.contentStore!;
  const [one, two] = hashes(restored);
  expect(one).not.toBe(two);
  expect(store[two].delta).toEqual(previous[suffixed].delta);
  expect(resolveContentStrict(store, one)).toEqual(first);
  expect(resolveContentStrict(store, two)).toEqual(second);
  expect(store[one].refCount).toBe(1);
  expect(store[two].refCount).toBe(3);
  expect(store[base].refCount).toBe(0);
  expect(previous).toEqual(before);
  expect(await toRecords(restored)).toEqual(records);
});

it('rejects damaged remote content even when a valid previous delta is available', async () => {
  const previous: ContentStoreData = {};
  const base = addContent(previous, longText());
  const hash = addContentDelta(previous, longText(' edited'), base);
  const records = await toRecords(snapshot(previous, [hash]));
  const key = Object.keys(records).find(key => JSON.parse(key)[0] === 'content')!;
  records[key] = JSON.stringify(text('damaged remote fixture'));
  const before = structuredClone(previous);
  await expect(fromRecords(records, previous)).rejects.toThrow('Missing or damaged message content');
  expect(previous).toEqual(before);
});


it('rejects damaged shared images rather than caching an unverified asset', async () => {
  const store: ContentStoreData = {};
  const hash = addContent(store, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj', detail: 'auto' } }]);
  const records = await toRecords(snapshot(store, [hash, hash]));
  const key = Object.keys(records).find(key => JSON.parse(key)[0] === 'assets')!;
  records[key] = JSON.stringify('data:image/png;base64,Y29ycnVwdA==');
  await expect(fromRecords(records, store)).rejects.toThrow('Missing or damaged image');
});
