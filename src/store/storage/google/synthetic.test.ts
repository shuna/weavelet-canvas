import { expect, it } from 'vitest';
import { computeContentHash, resolveContent, validateDeltaIntegrity } from '@utils/contentStore';
import { createSyntheticSnapshot, SYNTHETIC_PROFILE } from './synthetic';
import { fromRecords, toRecords } from './records';

const profile = { ...SYNTHETIC_PROFILE, treeChats: 3, treeNodes: 130,
  legacyChats: 4, legacyNodes: 23, maxTreeNodes: 80, maxDepth: 12, maxFanout: 8 };

it('generates reproducible fictional data with valid branches, hashes, deltas and scaling', async () => {
  const options = { profile, bodyBytes: 1024, seed: 123, sharedRatio: 0.3, editRatio: 0.5 };
  const snapshot = createSyntheticSnapshot(options);
  expect(createSyntheticSnapshot(options)).toEqual(snapshot);
  expect(createSyntheticSnapshot({ ...options, seed: 124 })).not.toEqual(snapshot);
  const chats = snapshot.state.chats!;
  expect(chats).toHaveLength(7);
  expect(chats.reduce((n, chat) => n + Object.keys(chat.branchTree?.nodes ?? {}).length, 0)).toBe(130);
  expect(chats.reduce((n, chat) => n + (chat.messages?.length ?? 0), 0)).toBe(23);
  expect(Object.keys(chats[0].branchTree!.nodes)).toHaveLength(80);
  let maxDepth = 0, maxFanout = 0;
  for (const chat of chats) {
    if (!chat.branchTree) continue;
    const { nodes, activePath, rootId } = chat.branchTree;
    expect(nodes[rootId].parentId).toBe(null);
    const children: Record<string, number> = {};
    for (const node of Object.values(nodes)) {
      let depth = 0, cursor: typeof node | undefined = node;
      const visited = new Set<string>();
      while (cursor) {
        expect(visited.has(cursor.id)).toBe(false);
        visited.add(cursor.id);
        depth++;
        if (cursor.parentId) expect(nodes[cursor.parentId]).toBeDefined();
        cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
      }
      maxDepth = Math.max(maxDepth, depth);
      if (node.parentId) children[node.parentId] = (children[node.parentId] ?? 0) + 1;
    }
    maxFanout = Math.max(maxFanout, ...Object.values(children));
    activePath.forEach((id, index) => expect(nodes[id].parentId).toBe(index ? activePath[index - 1] : null));
  }
  expect(maxDepth).toBe(12);
  expect(maxFanout).toBe(8);
  const store = snapshot.state.contentStore!;
  expect(Object.values(store).some(entry => entry.delta)).toBe(true);
  expect(validateDeltaIntegrity(store).size).toBe(0);
  for (const hash of Object.keys(store)) expect(computeContentHash(resolveContent(store, hash))).toBe(hash);
  const records = await toRecords(snapshot);
  expect(await toRecords(await fromRecords(records))).toEqual(records);
  const tripled = createSyntheticSnapshot({ ...options, scale: 3 });
  expect(tripled.state.chats).toHaveLength(21);
  expect(new Set(tripled.state.chats!.map(chat => chat.id)).size).toBe(21);
  expect(tripled.state.chats!.reduce((n, chat) => n + Object.keys(chat.branchTree?.nodes ?? {}).length, 0)).toBe(390);
});

it('controls sharing, local edits, compressibility and body size without using personal text', () => {
  const trees = { ...profile, treeChats: 1, treeNodes: 12, legacyChats: 0, legacyNodes: 0 };
  const shared = createSyntheticSnapshot({ profile: trees, sharedRatio: 1, bodyBytes: 256 });
  expect(Object.keys(shared.state.contentStore!)).toHaveLength(1);
  const random = createSyntheticSnapshot({ profile: trees, sharedRatio: 0, incompressible: true, bodyBytes: 256 });
  const larger = createSyntheticSnapshot({ profile: trees, sharedRatio: 0, bodyBytes: 512 });
  expect(Object.keys(random.state.contentStore!)).toHaveLength(12);
  expect(JSON.stringify(larger).length).toBeGreaterThan(JSON.stringify(random).length);
  for (const entry of Object.values(random.state.contentStore!)) {
    expect(entry.content).toHaveLength(1);
    expect(entry.content[0].type === 'text' && entry.content[0].text.length).toBe(256);
    expect(entry.delta).toBeUndefined();
  }
  expect(() => createSyntheticSnapshot({ sharedRatio: 0.8, editRatio: 0.8 })).toThrow();
  expect(() => createSyntheticSnapshot({ scale: 1.5 })).toThrow();
  expect(() => createSyntheticSnapshot({ profile: { ...trees, treeNodes: 1000 } })).toThrow();
});
