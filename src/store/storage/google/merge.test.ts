import { expect, it } from 'vitest';
import { mergeSyncRecords } from './merge';
import { toRecords, fromRecords, hashRecords, type Snapshot } from './records';
import { addContent, resolveContent } from '@utils/contentStore';
import type { ChatInterface } from '@type/chat';

const snapshot = (): Snapshot => {
  const state: Snapshot = { version: 16, state: { chats: [{ id: 'chat', title: 'Chat', messages: [], titleSet: true, imageDetail: 'auto', config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 }, branchTree: { nodes: {}, rootId: 'a', activePath: ['a', 'b', 'c'] } } as ChatInterface], contentStore: {} } };
  node(state, 'a', null, 'root'); node(state, 'b', 'a', 'original'); node(state, 'c', 'b', 'same continuation');
  return state;
};
function node(s: Snapshot, id: string, parentId: string | null, text: string) {
  s.state.chats![0].branchTree!.nodes[id] = { id, parentId, contentHash: addContent(s.state.contentStore!, [{ type: 'text', text }]), role: 'user', createdAt: 1 };
}
async function merge(base: Snapshot, local: Snapshot, cloud: Snapshot) {
  return fromRecords(await mergeSyncRecords(await hashRecords(await toRecords(base)), await toRecords(local), await toRecords(cloud)));
}
const text = (s: Snapshot, id: string) => resolveContent(s.state.contentStore!, s.state.chats![0].branchTree!.nodes[id].contentHash);
const tree = (s: Snapshot) => s.state.chats![0].branchTree!;

it('forks only the conflicting message within one chat, retaining both continuations and shared content', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'b', 'a', 'local'); node(cloud, 'b', 'a', 'cloud');
  local.state.chats![0].omittedNodes = { b: false };
  base.state.chats![0].omittedNodes = { b: false };
  cloud.state.chats![0].omittedNodes = { b: true };
  const result = await merge(base, local, cloud);
  expect(result.state.chats).toHaveLength(1);
  const alternatives = Object.values(tree(result).nodes).filter(n => n.parentId === 'a');
  expect(alternatives).toHaveLength(2);
  for (const alternative of alternatives) expect(result.state.chats![0].omittedNodes?.[alternative.id]).toBe(true);
  expect(alternatives.map(n => text(result, n.id)[0])).toEqual(expect.arrayContaining([{ type: 'text', text: 'local' }, { type: 'text', text: 'cloud' }]));
  for (const alternative of alternatives) expect(Object.values(tree(result).nodes).filter(n => n.parentId === alternative.id)).toHaveLength(1);
  expect(Object.keys(tree(result).nodes)).toHaveLength(5);
  expect(Object.keys(result.state.contentStore!)).toHaveLength(4);
  expect(text(result, tree(result).activePath[1])[0]).toEqual({ type: 'text', text: 'local' });
  expect(await toRecords(await merge(base, result, cloud))).toEqual(await toRecords(result));
});

it('coalesces independently created matching branches and their matching continuations', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'l', 'a', 'new'); node(local, 'lt', 'l', 'end');
  node(cloud, 'r', 'a', 'new'); node(cloud, 'rt', 'r', 'end');
  tree(local).activePath = ['a', 'l', 'lt']; tree(cloud).activePath = ['a', 'r', 'rt'];
  const result = await merge(base, local, cloud);
  expect(Object.keys(tree(result).nodes)).toHaveLength(5);
  expect(tree(result).activePath).toEqual(['a', 'r', 'rt']);
});

it('combines independent message edits without adding a branch', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'b', 'a', 'local'); node(cloud, 'c', 'b', 'cloud');
  const result = await merge(base, local, cloud);
  expect(Object.keys(tree(result).nodes)).toHaveLength(3);
  expect(text(result, 'b')[0]).toEqual({ type: 'text', text: 'local' });
  expect(text(result, 'c')[0]).toEqual({ type: 'text', text: 'cloud' });
});

it('does not duplicate a shared suffix when only the other child differs', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'l', 'c', 'left'); node(cloud, 'r', 'c', 'right');
  const result = await merge(base, local, cloud);
  expect(Object.keys(tree(result).nodes)).toHaveLength(5);
  expect(Object.values(tree(result).nodes).filter(n => n.parentId === 'c')).toHaveLength(2);
});

it('honors an unchanged subtree deletion but preserves a concurrently extended subtree', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  delete tree(local).nodes.c; tree(local).activePath.pop();
  node(local, 'b', 'a', 'local');
  const deleted = await merge(base, local, cloud);
  expect(tree(deleted).nodes.c).toBeUndefined();
  node(cloud, 'd', 'c', 'extended');
  const retained = await merge(base, local, cloud);
  expect(retained.state.chats).toHaveLength(1);
  expect(Object.keys(tree(retained).nodes)).toHaveLength(4);
  expect(tree(retained).activePath).toEqual(['a', 'b']);
});

it('preserves coherent alternatives if independent reparenting would create a cycle', async () => {
  const base = snapshot(); tree(base).nodes.c.parentId = 'a'; tree(base).activePath = ['a', 'b'];
  const local = structuredClone(base), cloud = structuredClone(base);
  tree(local).nodes.b.parentId = 'c'; tree(local).activePath = ['a', 'c', 'b'];
  tree(cloud).nodes.c.parentId = 'b';
  const result = await merge(base, local, cloud);
  expect(result.state.chats).toHaveLength(1);
  expect(Object.keys(tree(result).nodes)).toHaveLength(5);
  expect(tree(result).activePath).toHaveLength(3);
});

it('keeps node review markers until explicit acknowledgement, including across reloads', async () => {
  const { useSyncReview, markSyncChanges, acknowledgeSyncChat, acknowledgeSyncNode } = await import('./conflicts');
  useSyncReview.setState({ chats: [], folders: [], nodes: {} });
  const before = snapshot();
  node(before, 'unrelated', 'a', 'unchanged alternative');
  const remote = structuredClone(before);
  node(remote, 'b', 'a', 'remote');
  const after = await merge(before, before, remote);
  await markSyncChanges(before, after);
  expect(useSyncReview.getState().nodes.chat).toContain('b');
  expect(useSyncReview.getState().nodes.chat).not.toContain('unrelated');
  const saved = localStorage.getItem('weavelet-sync-review')!;
  expect(saved).not.toContain('remote');
  useSyncReview.setState({ chats: [], folders: [], nodes: {} });
  localStorage.setItem('weavelet-sync-review', saved);
  await useSyncReview.persist.rehydrate();
  expect(useSyncReview.getState().nodes.chat).toContain('b');
  acknowledgeSyncNode('chat', 'b');
  expect(useSyncReview.getState().nodes.chat).not.toContain('b');
  expect(useSyncReview.getState().chats).toContain('chat');
  acknowledgeSyncChat('chat');
  expect(useSyncReview.getState().chats).not.toContain('chat');
  expect(useSyncReview.getState().nodes.chat).toEqual([]);
});
