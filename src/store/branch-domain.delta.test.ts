/**
 * Tests for branch-domain delta integration:
 * - createBranchState with image content → full storage
 * - upsertMessageAtIndexState / updateLastNodeContentState → delta against old hash
 */
import { describe, expect, it } from 'vitest';
import {
  createBranchState,
  upsertMessageAtIndexState,
  updateLastNodeContentState,
} from './branch-domain';
import {
  ContentStoreData,
  addContent,
  retainContent,
} from '@utils/contentStore';
import type { ChatInterface, ContentInterface, BranchNode } from '@type/chat';

const text = (t: string): ContentInterface[] => [{ type: 'text', text: t }];
const image = (): ContentInterface[] => [
  { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'auto' } },
];

const L = 'This is a fairly long text that simulates a real chat message with enough content to make delta compression worthwhile. It contains multiple sentences.';
const lt = (suffix: string): ContentInterface[] => [{ type: 'text', text: L + suffix }];

function makeSimpleChat(
  contentStore: ContentStoreData,
  contents: ContentInterface[][]
): { chats: ChatInterface[]; contentStore: ContentStoreData } {
  const cs = { ...contentStore };
  const nodes: Record<string, BranchNode> = {};
  const hashes: string[] = [];

  for (let i = 0; i < contents.length; i++) {
    const hash = addContent(cs, contents[i]);
    hashes.push(hash);
    nodes[`n${i}`] = {
      id: `n${i}`,
      parentId: i > 0 ? `n${i - 1}` : null,
      role: i % 2 === 0 ? 'user' : 'assistant',
      contentHash: hash,
      createdAt: 0,
    };
  }

  const chat: ChatInterface = {
    id: 'chat-1',
    title: 'Test',
    config: {} as any,
    titleSet: false,
    imageDetail: 'auto',
    messages: contents.map((c, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as any,
      content: c,
    })),
    branchTree: {
      rootId: 'n0',
      activePath: contents.map((_, i) => `n${i}`),
      nodes,
    },
  };

  return { chats: [chat], contentStore: cs };
}

describe('createBranchState delta integration', () => {
  it('image content results in full storage (no delta)', () => {
    const cs: ContentStoreData = {};
    const { chats, contentStore } = makeSimpleChat(cs, [lt('')]);
    const fromNodeId = 'n0';

    const result = createBranchState(chats, 0, fromNodeId, image(), contentStore);

    // Find the new node's contentHash
    const newNode = result.chats[0].branchTree!.nodes[result.newId];
    const entry = result.contentStore[newNode.contentHash];
    expect(entry.delta).toBeUndefined();
    expect(entry.content).toEqual(image());
  });

  it('text content uses delta against fromNode hash', () => {
    const cs: ContentStoreData = {};
    const { chats, contentStore } = makeSimpleChat(cs, [lt('')]);
    const fromNodeId = 'n0';

    const result = createBranchState(chats, 0, fromNodeId, lt(' branch edit'), contentStore);
    const newNode = result.chats[0].branchTree!.nodes[result.newId];
    const entry = result.contentStore[newNode.contentHash];

    // Should be stored as delta since text is similar
    expect(entry.delta).toBeDefined();
  });
});

describe('upsertMessageAtIndexState delta', () => {
  it('uses delta against old hash when editing existing node (shared base)', () => {
    const cs: ContentStoreData = {};
    const { chats, contentStore } = makeSimpleChat(cs, [lt(''), lt(' reply')]);

    // Retain base so it has refCount > 1 — delta persists only when base is shared
    const oldHash = chats[0].branchTree!.nodes['n0'].contentHash;
    retainContent(contentStore, oldHash);

    const result = upsertMessageAtIndexState(
      chats, 0, 0,
      { role: 'user', content: lt(' edited') },
      contentStore
    );

    const tree = result.chats[0].branchTree!;
    const editedNode = tree.nodes[tree.activePath[0]];
    const entry = result.contentStore[editedNode.contentHash];

    // Delta should be used since base is shared (refCount > 0 after release)
    expect(entry.delta).toBeDefined();
  });

  it('promotes delta to full when old hash is sole reference', () => {
    const cs: ContentStoreData = {};
    const { chats, contentStore } = makeSimpleChat(cs, [lt(''), lt(' reply')]);

    // Don't retain — refCount=1, will drop to 0, triggering promotion
    const result = upsertMessageAtIndexState(
      chats, 0, 0,
      { role: 'user', content: lt(' edited') },
      contentStore
    );

    const tree = result.chats[0].branchTree!;
    const editedNode = tree.nodes[tree.activePath[0]];
    const entry = result.contentStore[editedNode.contentHash];

    // Delta gets promoted to full because base refCount dropped to 0
    expect(entry.delta).toBeUndefined();
    expect(entry.content).toEqual(lt(' edited'));
  });
});

describe('updateLastNodeContentState delta', () => {
  it('uses delta against old hash for last node update (shared base)', () => {
    const cs: ContentStoreData = {};
    const { chats, contentStore } = makeSimpleChat(cs, [lt(''), lt(' original')]);

    // Retain last node's hash so delta persists
    const lastId = chats[0].branchTree!.activePath[chats[0].branchTree!.activePath.length - 1];
    retainContent(contentStore, chats[0].branchTree!.nodes[lastId].contentHash);

    const result = updateLastNodeContentState(
      chats, 0,
      lt(' original with small edit'),
      contentStore
    );

    const tree = result.chats[0].branchTree!;
    const newLastId = tree.activePath[tree.activePath.length - 1];
    const entry = result.contentStore[tree.nodes[newLastId].contentHash];

    expect(entry.delta).toBeDefined();
  });
});
