import { beforeEach, expect, it } from 'vitest';
import { digest } from './crypto';
import { canonical, fromRecords, hashRecords, projectRecords, sameSnapshot, toRecords, type Snapshot } from './records';
import { clearRecordCaches, getMetadataProjectionStats, getRecordCacheStats } from './recordCache';
import { createSyntheticSnapshot } from './synthetic';

const fixture = (): Snapshot => ({ version: 4, state: {
  chats: [{ id: 'chat', title: 'fictional', titleSet: true, imageDetail: 'auto',
    config: { model: 'synthetic', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 }, messages: [], branchTree: {
    rootId: 'a', activePath: ['a', 'b'], nodes: {
      a: { id: 'a', createdAt: 1, parentId: null, role: 'user', contentHash: 'local', label: 'first' },
      b: { id: 'b', createdAt: 2, parentId: 'a', role: 'assistant', contentHash: 'local', label: 'second' },
    },
  } }], contentStore: { local: { content: [{ type: 'text', text: 'Synthetic body '.repeat(300) }], refCount: 2 } },
  defaultSystemMessage: 'Fictional system setting',
} } as Snapshot);
const node = (value: Snapshot, id = 'a') => value.state.chats![0].branchTree!.nodes[id];
beforeEach(clearRecordCaches);

it('reuses normalized node/chat flattening and SHA across worker-like clones', async () => {
  const value = fixture(), original = JSON.stringify(value);
  const first = await projectRecords(value);
  const second = await projectRecords(structuredClone(value));
  expect(second).toEqual(first);
  expect(getMetadataProjectionStats()).toEqual({ nodeHits: 2, nodeMisses: 2, chatHits: 1, chatMisses: 1, rootHits: 1, rootMisses: 1 });
  expect(JSON.stringify(value)).toBe(original);
  const before = getRecordCacheStats().digestMisses;
  const hashes = await hashRecords(structuredClone(second.records));
  expect(getRecordCacheStats().digestMisses).toBe(before);
  for (const [key, field] of Object.entries(second.records)) expect(hashes[key]).toBe(await digest(field));
  expect(await projectRecords(value, { cache: false })).toEqual(first);
});

it.each(['parentId', 'role', 'label', 'unknownFutureField'])('includes %s in node and chat SHA and preserves undo', async field => {
  const value = fixture(), first = await projectRecords(value);
  (node(value) as any)[field] = 'changed';
  const changed = await projectRecords(value);
  expect(changed.nodeHashes.chat.a).not.toBe(first.nodeHashes.chat.a);
  expect(changed.nodeHashes.chat.b).toBe(first.nodeHashes.chat.b);
  expect(changed.chatHashes.chat).not.toBe(first.chatHashes.chat);
  expect(changed.rootHash).not.toBe(first.rootHash);
  expect(changed).toEqual(await projectRecords(value, { cache: false }));
  expect(await projectRecords(fixture())).toEqual(first);
});

it('notices in-place bodies and imported local ID reuse, with authoritative sync restoration', async () => {
  const value = fixture(), first = await projectRecords(value);
  value.state.contentStore!.local.content = [{ type: 'text', text: 'Replaced synthetic body' }];
  const changed = await projectRecords(value);
  expect(changed.nodeHashes.chat.a).not.toBe(first.nodeHashes.chat.a);
  expect(changed).toEqual(await projectRecords(structuredClone(value), { cache: false }));
  expect(await toRecords(await fromRecords(changed.records))).toEqual(changed.records);
  expect(await sameSnapshot([fixture(), value])).toBe(false);
});

it('handles chat/node deletion, active paths, order and empty sentinel records', async () => {
  const value = fixture();
  await projectRecords(value);
  delete value.state.chats![0].branchTree!.nodes.b;
  value.state.chats![0].branchTree!.activePath = ['a'];
  const changed = await projectRecords(value);
  expect(changed.nodeHashes.chat.b).toBeUndefined();
  expect(Object.keys(changed.records).some(key => JSON.parse(key).includes('b'))).toBe(false);
  expect(changed).toEqual(await projectRecords(value, { cache: false }));
  value.state.chats = [];
  const empty = await projectRecords(value);
  expect(empty.records['["chats"]']).toBe('{}');
  expect(empty.records['["order"]']).toBe('[]');
  expect(empty).toEqual(await projectRecords(value, { cache: false }));
});

it('normalizes imported property order and tracks chat additions/reordering', async () => {
  const value = fixture(), initial = await projectRecords(value);
  const original = node(value);
  value.state.chats![0].branchTree!.nodes.a = Object.fromEntries(Object.entries(original).reverse()) as typeof original;
  expect(await projectRecords(value)).toEqual(initial);
  const second = structuredClone(value.state.chats![0]);
  second.id = 'another';
  value.state.chats!.push(second);
  const added = await projectRecords(value);
  expect(added.chatHashes.another).toBeDefined();
  expect(added.chatHashes.chat).toBe(initial.chatHashes.chat);
  value.state.chats!.reverse();
  const reordered = await projectRecords(value);
  expect(reordered.rootHash).not.toBe(added.rootHash);
  expect(reordered.chatHashes).toEqual(added.chatHashes);
  expect(reordered).toEqual(await projectRecords(value, { cache: false }));
});

it('includes generation identity, clipboard and global settings, excluding local UI state', async () => {
  const value = fixture(), first = await projectRecords(value);
  value.state.pendingVerifications = { 'chat:::a': { generationId: 'synthetic-generation' } } as any;
  const verified = await projectRecords(value);
  expect(verified.nodeHashes.chat.a).not.toBe(first.nodeHashes.chat.a);
  expect(verified.records['["chats","chat","branchTree","nodes","a","openRouterObservation","generationId"]']).toBe('"synthetic-generation"');
  const changed = structuredClone(value);
  changed.state.defaultSystemMessage = 'Changed setting';
  expect(await sameSnapshot([value, changed])).toBe(false);
  changed.state.defaultSystemMessage = value.state.defaultSystemMessage;
  changed.state.menuWidth = 999;
  expect(await sameSnapshot([value, changed])).toBe(true);
  (changed.state as any).branchClipboard = { nodes: { clip: { ...node(changed), id: 'clip' } } };
  expect((await projectRecords(changed)).rootHash).not.toBe(verified.rootHash);
});

it('never trusts caller-mutated records and never exposes reusable fragments', async () => {
  const value = fixture(), first = await projectRecords(value), expected = structuredClone(first);
  const key = '["chats","chat","title"]';
  first.records[key] = '"Caller mutation"';
  first.records['["extra"]'] = '1';
  delete first.records['["order"]'];
  const hashes = await hashRecords(first.records);
  expect(hashes[key]).toBe(await digest(first.records[key]));
  expect(hashes['["extra"]']).toBe(await digest('1'));
  expect(hashes['["order"]']).toBeUndefined();
  expect(await projectRecords(value)).toEqual(expected);
});

it('preserves the legacy flatten representation across trees, legacy messages and image assets', async () => {
  const value = createSyntheticSnapshot({ bodyBytes: 64, profile: {
    treeChats: 1, treeNodes: 3, legacyChats: 1, legacyNodes: 2,
    maxTreeNodes: 3, maxDepth: 3, maxFanout: 2, targetJsonBytes: 0,
  } });
  value.state.chats![1].messages![0].content.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,SYNTHETIC', detail: 'auto' } });
  const result = await projectRecords(value);
  // Independent reference flatten of the restored logical snapshot, using the known body mapping.
  const state: any = structuredClone(value.state), chats: any = {};
  delete state.contentStore; delete state.chats;
  const content: Record<string, string> = {}, assets: Record<string, string> = {};
  for (const original of value.state.chats!) {
    const chat = structuredClone(original);
    if (chat.branchTree) {
      delete (chat as any).messages;
      for (const item of Object.values(chat.branchTree.nodes)) {
        const body = canonical(value.state.contentStore![item.contentHash].content);
        item.contentHash = await digest(body); content[item.contentHash] = body;
      }
    } else for (const message of chat.messages ?? []) for (const part of message.content) if (part.type === 'image_url') {
      const url = part.image_url.url, id = await digest(url);
      assets[id] = JSON.stringify(url); (part.image_url as any).url = { asset: id };
    }
    chats[chat.id] = chat;
  }
  const reference: Record<string, string> = {};
  const flatten = (item: any, path: string[]) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length) {
      for (const [key, child] of Object.entries(item)) flatten(child, [...path, key]);
    } else reference[JSON.stringify(path)] = canonical(item);
  };
  flatten({ version: value.version ?? 0, state, chats, order: value.state.chats!.map(chat => chat.id) }, []);
  for (const [id, body] of Object.entries(content)) reference[JSON.stringify(['content', id])] = body;
  for (const [id, body] of Object.entries(assets)) reference[JSON.stringify(['assets', id])] = body;
  expect(result.records).toEqual(reference);
  expect(await toRecords(await fromRecords(result.records))).toEqual(reference);
});

it('rejects unsafe keys even after successful cached projections', async () => {
  const value = fixture();
  await projectRecords(value);
  Object.defineProperty(node(value), '__proto__', { value: { unsafe: true }, enumerable: true });
  await expect(projectRecords(value)).rejects.toThrow('Unsafe');
});
