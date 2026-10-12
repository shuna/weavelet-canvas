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

it('preserves both folder hierarchies and descendant chats when a parent conflicts', async () => {
  const base = snapshot();
  base.state.folders = {
    root: { id: 'root', name: 'Root', order: 0, expanded: true },
    child: { id: 'child', parentId: 'root', name: 'Child', order: 1, expanded: false },
    leaf: { id: 'leaf', parentId: 'child', name: 'Leaf', order: 2, expanded: false },
  };
  base.state.chats![0].folder = 'leaf';
  const local = structuredClone(base), cloud = structuredClone(base);
  local.state.folders!.root.name = 'Local';
  cloud.state.folders!.root.name = 'Cloud';
  const result = await merge(base, local, cloud);
  const folders = result.state.folders!;
  expect(Object.keys(folders)).toHaveLength(6);
  expect(folders.root.name).toBe('Cloud');
  expect(folders.child.parentId).toBe('root');
  const localRoot = Object.values(folders).find(folder => folder.name === 'Local')!;
  const localChild = Object.values(folders).find(folder => folder.parentId === localRoot.id)!;
  const localLeaf = Object.values(folders).find(folder => folder.parentId === localChild.id)!;
  expect(result.state.chats!.map(chat => chat.folder)).toEqual(expect.arrayContaining(['leaf', localLeaf.id]));
});

it('rejects orphaned and cyclic folder graphs before syncing', async () => {
  const value = snapshot();
  value.state.folders = { root: { id: 'root', parentId: 'missing', name: 'Root', order: 0, expanded: true } };
  await expect(toRecords(value)).rejects.toThrow('folder hierarchy');
  value.state.folders.root.parentId = null;
  const records = await toRecords(value);
  records[JSON.stringify(['state', 'folders', 'root', 'parentId'])] = JSON.stringify('root');
  await expect(fromRecords(records)).rejects.toThrow('folder hierarchy');
});

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
  expect(Object.keys(result.state.contentStore!)).toHaveLength(5);
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

it('preserves each copied chat order after metadata conflict even with shuffled input records', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  local.state.chats![0].title = 'Local'; cloud.state.chats![0].title = 'Cloud';
  tree(local).nodes = Object.fromEntries(['c', 'a', 'b'].map(id => [id, tree(local).nodes[id]]));
  tree(cloud).nodes = Object.fromEntries(['b', 'c', 'a'].map(id => [id, tree(cloud).nodes[id]]));
  const shuffle = (records: Record<string, string>) => Object.fromEntries(Object.entries(records).reverse());
  const result = await fromRecords(await mergeSyncRecords(
    await hashRecords(await toRecords(base)), shuffle(await toRecords(local)), shuffle(await toRecords(cloud))
  ));
  expect(result.state.chats).toHaveLength(2);
  const byTitle = Object.fromEntries(result.state.chats!.map(chat => [chat.title, chat]));
  expect(Object.keys(byTitle.Local.branchTree!.nodes)).toEqual(['c', 'a', 'b']);
  expect(Object.keys(byTitle.Cloud.branchTree!.nodes)).toEqual(['b', 'c', 'a']);
  const records = await toRecords(result);
  expect(records[JSON.stringify(['nodeOrder', 'chats', byTitle.Local.id])]).toBe('["c","a","b"]');
  expect(records[JSON.stringify(['nodeOrder', 'chats', byTitle.Cloud.id])]).toBe('["b","c","a"]');
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

it.each([false, true])('preserves a preexisting pinned orphan parent and child after both inputs are edited (active=%s)', async active => {
  const base = snapshot();
  node(base, 'orphan', 'missing-parent', 'pinned orphan content');
  tree(base).nodes.orphan.pinned = true;
  tree(base).nodes.orphan.label = 'pinned orphan label';
  node(base, 'orphan-child', 'orphan', 'orphan child content');
  if (active) tree(base).activePath = ['orphan', 'orphan-child'];
  const local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'b', 'a', 'local'); node(cloud, 'c', 'b', 'cloud');
  const result = await merge(base, local, cloud);
  expect(result.state.chats).toHaveLength(1);
  expect(tree(result).nodes.orphan).toEqual(expect.objectContaining({
    id: 'orphan', parentId: 'missing-parent', pinned: true, label: 'pinned orphan label',
  }));
  expect(tree(result).nodes['orphan-child'].parentId).toBe('orphan');
  expect(text(result, 'orphan')).toEqual([{ type: 'text', text: 'pinned orphan content' }]);
  expect(text(result, 'orphan-child')).toEqual([{ type: 'text', text: 'orphan child content' }]);
  if (active) {
    expect(tree(result).activePath).toEqual(['orphan', 'orphan-child']);
  } else {
    expect(tree(result).activePath.flatMap(id => text(result, id))).toEqual([
      { type: 'text', text: 'root' }, { type: 'text', text: 'local' },
      { type: 'text', text: 'same continuation' },
    ]);
  }
  expect(Object.keys(tree(result).nodes).flatMap(id => text(result, id))).toEqual(expect.arrayContaining([
    { type: 'text', text: 'local' }, { type: 'text', text: 'cloud' },
  ]));
});

it('preserves separate valid chats when pinned orphan parent IDs collide into a cycle', async () => {
  const base = snapshot();
  tree(base).nodes = {};
  tree(base).rootId = '';
  tree(base).activePath = [];
  base.state.contentStore = {};
  const local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'y', 'x', 'local pinned orphan');
  tree(local).nodes.y.pinned = true;
  tree(local).rootId = 'y';
  tree(local).activePath = ['y'];
  node(cloud, 'x', 'y', 'cloud pinned orphan');
  tree(cloud).nodes.x.pinned = true;
  tree(cloud).rootId = 'x';
  tree(cloud).activePath = ['x'];
  const result = await merge(base, local, cloud);
  expect(result.state.chats).toHaveLength(2);
  expect(new Set(result.state.chats!.map(chat => chat.id)).size).toBe(2);
  const branches = result.state.chats!.map(chat => {
    const branch = chat.branchTree!;
    expect(Object.keys(branch.nodes)).toHaveLength(1);
    const retained = Object.values(branch.nodes)[0];
    expect(branch.rootId).toBe(retained.id);
    expect(branch.activePath).toEqual([retained.id]);
    return {
      id: retained.id, parentId: retained.parentId, pinned: retained.pinned,
      content: resolveContent(result.state.contentStore!, retained.contentHash),
    };
  });
  expect(branches).toEqual(expect.arrayContaining([
    { id: 'y', parentId: 'x', pinned: true, content: [{ type: 'text', text: 'local pinned orphan' }] },
    { id: 'x', parentId: 'y', pinned: true, content: [{ type: 'text', text: 'cloud pinned orphan' }] },
  ]));
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


it('acknowledges all chats, folders and branch nodes persistently without resolving conflicts', async () => {
  const { useSyncReview, acknowledgeAllSyncChanges, markSyncChanges } = await import('./conflicts');
  useSyncReview.setState({ conflict: true, chats: ['chat', 'hidden-chat'], folders: ['folder'], nodes: { chat: ['b'], 'hidden-chat': ['x'] } });
  acknowledgeAllSyncChanges();
  expect(useSyncReview.getState()).toEqual({ conflict: true, conflictKeys: [], cloudOverview: null, cloudReview: null, chats: [], folders: [], nodes: {} });
  await useSyncReview.persist.rehydrate();
  expect(useSyncReview.getState()).toEqual({ conflict: true, conflictKeys: [], cloudOverview: null, cloudReview: null, chats: [], folders: [], nodes: {} });
  const before = snapshot(), after = structuredClone(before);
  node(after, 'b', 'a', 'new sync change');
  await markSyncChanges(before, after);
  expect(useSyncReview.getState().chats).toEqual(['chat']);
  expect(useSyncReview.getState().nodes.chat).toEqual(['b']);
  acknowledgeAllSyncChanges();
  useSyncReview.setState({ conflict: false });
});

it('remaps locally generated summary references when matching branches coalesce', async () => {
  const base = snapshot(), local = structuredClone(base), cloud = structuredClone(base);
  node(local, 'l', 'a', 'new'); node(local, 'lt', 'l', 'end');
  node(cloud, 'r', 'a', 'new'); node(cloud, 'rt', 'r', 'end');
  tree(local).activePath = ['a', 'l', 'lt']; tree(cloud).activePath = ['a', 'r', 'rt'];
  local.state.chats![0].summaryTargets = { l: true };
  local.state.chats![0].summaries = [{ id: 'summary', mode: 'range', text: 'new then end', useForSubmit: true, sources: [
    { nodeId: 'l', parentId: 'a', role: 'user', textParts: ['new'] },
    { nodeId: 'lt', parentId: 'l', role: 'user', textParts: ['end'] },
  ] }];
  const result = await merge(base, local, cloud);
  expect(result.state.chats![0].summaries![0].sources.map(source => source.nodeId)).toEqual(['r', 'rt']);
  expect(result.state.chats![0].summaries![0].sources.map(source => source.parentId)).toEqual(['a', 'r']);
  expect(result.state.chats![0].summaryTargets?.r).toBe(true);
});
