import { describe, expect, it, vi } from 'vitest';
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('uuid', () => ({ v4: () => editingUUID() }));
import { editingUUID, withEditingRuntime } from '../../shared/google-sync/editing';
import { nodeRemoval } from '../../shared/google-sync/nodeRemoval';
import { removeNodeState, removeMessageAtIndexState, pruneHiddenNodesState, upsertMessageAtIndexState } from './branch-domain';
import { createChatSlice } from './chat-slice';
import { createBranchSlice } from './branch-slice';
import { materializeActivePath } from '../utils/branchUtils';
import { resolveContent } from '../utils/contentStore';
import { fromRecords, toRecords } from './storage/google/records';
import type { StoreState } from './store';
import type { StoreApi } from 'zustand';

function fixture() {
  const nodes: any = {}, contentStore: any = {};
  for (const [id, parentId] of [['root', null], ['middle', 'root'], ['last', 'middle'], ['other', 'middle'], ['hidden', 'root'], ['pinned', 'hidden'], ['pin-child', 'pinned'], ['protected', 'hidden'], ['protected-child', 'protected']]) {
    nodes[id!] = { id, parentId, role: 'user', contentHash: id, createdAt: 1, xNode: { opaqueRef: 1 } };
    contentStore[id!] = { content: [{ type: 'text', text: id, xPart: { opaqueRef: 2 } }], refCount: 1, xEntry: { opaqueRef: 3 } };
  }
  nodes.middle.pinned = true; nodes.pinned.pinned = true; nodes.hidden.pinned = false;
  contentStore.unused = { content: [{ type: 'text', text: 'unused' }], refCount: 0, xUnused: { opaqueRef: 4 } };
  const tree = { nodes, rootId: 'root', activePath: ['root', 'middle', 'last'], xTree: { opaqueRef: 5 },
    messageAttributesV1: { version: 1, byNode: Object.fromEntries(Object.keys(nodes).map(id => [id, { xMessage: { opaqueRef: 6 } }])) } };
  const chat: any = { id: 'target', title: 'Title', titleSet: true, imageDetail: 'auto', config: { model: 'FAKE', max_tokens: 1, temperature: 1, top_p: 1, frequency_penalty: 0, presence_penalty: 0 },
    branchTree: tree, messages: materializeActivePath(tree as any, contentStore, true), protectedNodes: { protected: true }, omittedNodes: { last: true }, xChat: { opaqueRef: 7 } };
  return { chat, contentStore };
}
function apply(source: any, changes: any[]) {
  const output = structuredClone(source);
  for (const change of changes) {
    let parent = output;
    for (const part of change.path.slice(0, -1)) parent = parent[part];
    const key = change.path.at(-1);
    if (change.op === 'set') parent[key] = change.value;
    else if (change.op === 'remove') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
    else {
      const object = change.path.length ? parent[key] : output;
      const entries = change.keys.map((key: string) => [key, object[key]]);
      Object.keys(object).forEach(key => delete object[key]); Object.assign(object, Object.fromEntries(entries));
    }
  }
  return output;
}
function run(source: any, operation: string, nodeID?: string | null, viewingPath = source.chat.branchTree?.activePath ?? []) {
  const changes = JSON.parse(nodeRemoval(JSON.stringify({ ...source, operation, nodeID, viewingPath, newIDs: ['flat-0', 'flat-1'], now: 1000 })));
  return apply(source, changes);
}
function state(source: any) {
  let state: StoreState;
  const get = () => state;
  const set = ((partial: unknown) => { state = { ...state, ...(typeof partial === 'function' ? (partial as any)(state) : partial) }; }) as StoreApi<StoreState>['setState'];
  state = { ...createChatSlice(set, get), ...createBranchSlice(set, get), chats: [source.chat], contentStore: source.contentStore } as StoreState;
  return get;
}
describe('shared single-node removal and hidden-branch pruning', () => {
  it('removes one pinned message, reparents all children and preserves successor flags/metadata/body references', () => {
    const source = fixture(), before = structuredClone(source);
    const output = run(source, 'remove', 'middle');
    expect(Object.keys(output.chat.branchTree.nodes)).toEqual(['root', 'last', 'other', 'hidden', 'pinned', 'pin-child', 'protected', 'protected-child']);
    expect(output.chat.branchTree.activePath).toEqual(['root', 'last']);
    expect(output.chat.branchTree.nodes.last.parentId).toBe('root'); expect(output.chat.branchTree.nodes.other.parentId).toBe('root');
    expect(output.chat.branchTree.messageAttributesV1.byNode.middle).toBeUndefined();
    expect(output.chat.branchTree.messageAttributesV1.byNode.last).toEqual({ xMessage: { opaqueRef: 6 } });
    expect(output.chat.omittedNodes).toEqual({ last: true }); expect(output.chat.protectedNodes).toEqual(source.chat.protectedNodes);
    expect(output.chat.branchTree.nodes.last.xNode).toEqual(source.chat.branchTree.nodes.last.xNode);
    expect(output.contentStore.middle.refCount).toBe(0); expect(output.contentStore.last).toEqual(source.contentStore.last); expect(output.contentStore.unused).toEqual(source.contentStore.unused);
    expect(source).toEqual(before);
  });
  it('rejects protected/missing/inactive targets before publishing or converting flat input', () => {
    const source = fixture(), before = structuredClone(source);
    source.chat.protectedNodes.middle = true;
    expect(() => run(source, 'remove', 'middle')).toThrow('protected');
    expect(() => run(source, 'remove', 'missing')).toThrow('node-missing');
    expect(() => run(source, 'remove', 'hidden')).toThrow('invalid-target');
    expect(() => run(source, 'remove', null)).toThrow('Invalid removal target');
    delete source.chat.protectedNodes.middle; expect(source).toEqual(before);
    const flat: any = { chat: { ...source.chat, branchTree: undefined, messages: source.chat.messages, protectedNodes: { '0': true } }, contentStore: source.contentStore };
    expect(() => run(flat, 'remove', 'message-0')).toThrow('protected'); expect(flat.chat.branchTree).toBeUndefined();
  });
  it('uses actual Web caller and preserves generated-node keep policy/history', () => {
    const source = fixture(), before = structuredClone(source), get = state(source);
    withEditingRuntime([], Object.keys(source.chat.branchTree.nodes), 1000, () => {
      expect(get().removeNode({ chatId: source.chat.id, nodeId: 'middle' })).toEqual({ status: 'updated' });
    });
    expect(get().chats![0].branchTree!.activePath).toEqual(['root', 'last']); expect(get().branchHistoryPast).toHaveLength(1);
    expect(source).toEqual(before);
    const retained = fixture(); const keep = removeNodeState([retained.chat], { chatId: retained.chat.id, nodeId: 'middle' }, retained.contentStore, { preserveNode: true });
    expect(keep.status).toBe('updated');
    if (keep.status === 'updated') {
      expect(keep.chats[0].branchTree!.nodes.middle).toEqual(retained.chat.branchTree.nodes.middle);
      expect(keep.chats[0].branchTree!.activePath).toEqual(['root', 'last']); expect(keep.contentStore.middle.refCount).toBe(1);
    }
  });
  it('keeps active nodes plus pinned subtrees and protected individual nodes, while detaching orphan survivors', () => {
    const source = fixture(), before = structuredClone(source), output = run(source, 'pruneHidden');
    expect(Object.keys(output.chat.branchTree.nodes)).toEqual(['root', 'middle', 'last', 'other', 'pinned', 'pin-child', 'protected']);
    // Middle is pinned, so its inactive child other also survives.
    expect(output.chat.branchTree.nodes.pinned.parentId).toBeNull(); expect(output.chat.branchTree.nodes.protected.parentId).toBeNull();
    expect(output.chat.branchTree.messageAttributesV1.byNode.hidden).toBeUndefined(); expect(output.chat.branchTree.messageAttributesV1.byNode['protected-child']).toBeUndefined();
    expect(output.contentStore.hidden.refCount).toBe(0); expect(output.contentStore['protected-child'].refCount).toBe(0);
    expect(output.contentStore.pinned.refCount).toBe(1); expect(output.chat.xChat).toEqual(source.chat.xChat); expect(source).toEqual(before);
    const get = state(fixture());
    withEditingRuntime([], [], 1000, () => get().pruneHiddenNodes(0));
    expect(Object.keys(get().chats![0].branchTree!.nodes)).toEqual(Object.keys(output.chat.branchTree.nodes));
    expect(get().branchHistoryPast).toHaveLength(1);
  });
  it('corrects a removed stale root on empty path and permits Google-record roundtrip with orphan pinned survivors', async () => {
    const source = fixture(); source.chat.branchTree.activePath = []; source.chat.messages = [];
    source.chat.branchTree.nodes.middle.pinned = false;
    const output = run(source, 'pruneHidden');
    expect(output.chat.branchTree.rootId).toBe(''); expect(output.chat.branchTree.activePath).toEqual([]);
    expect(Object.keys(output.chat.branchTree.nodes)).toEqual(['pinned', 'pin-child', 'protected']);
    const result = await fromRecords(await toRecords({ version: 18, state: { chats: [output.chat], contentStore: output.contentStore } }));
    expect(result.state.chats![0].branchTree!.rootId).toBe('');
  });
  it('removes a sole flat message to empty tree, remaps flags and keeps flat prune a no-op', () => {
    const source = fixture(); source.chat.branchTree = undefined;
    source.chat.messages = [{ role: 'user', content: [{ type: 'text', text: 'sole', xPart: { opaqueRef: 10 } }], xMessage: { opaqueRef: 11 } }];
    source.chat.protectedNodes = {}; source.chat.omittedNodes = { '0': true };
    const before = structuredClone(source);
    const pruned = run(source, 'pruneHidden'); expect(pruned).toEqual(source);
    const removed = run(source, 'remove', 'message-0');
    expect(removed.chat.branchTree.rootId).toBe(''); expect(removed.chat.branchTree.activePath).toEqual([]); expect(removed.chat.branchTree.nodes).toEqual({});
    expect(removed.chat.branchTree.messageAttributesV1.byNode).toEqual({}); expect(removed.chat.messages).toEqual([]); expect(removed.chat.omittedNodes).toEqual({ 'flat-0': true });
    expect(source).toEqual(before);
  });
  it('keeps old store entries untouched through release, dependent delta promotion and other prepared edits', () => {
    const source = fixture(); source.contentStore.dep = { content: [], refCount: 1, delta: { baseHash: 'middle', patches: '' }, xFuture: { opaqueRef: 12 } };
    const before = structuredClone(source);
    const result = removeMessageAtIndexState([source.chat], 0, 1, source.contentStore);
    expect(result.contentStore.middle.refCount).toBe(0); expect(result.contentStore.dep.delta).toBeUndefined();
    expect((result.contentStore.dep as any).xFuture).toEqual({ opaqueRef: 12 }); expect(resolveContent(result.contentStore, 'dep')).toEqual(source.contentStore.middle.content);
    expect(source).toEqual(before);
    const pruneSource = fixture(), pruneBefore = structuredClone(pruneSource);
    const pruned = pruneHiddenNodesState([pruneSource.chat], 0, pruneSource.contentStore);
    expect(pruned.contentStore.hidden.refCount).toBe(0); expect(pruneSource).toEqual(pruneBefore);
    upsertMessageAtIndexState([source.chat], 0, 1, { role: 'user', content: [{ type: 'text', text: 'edited' }] }, source.contentStore);
    expect(source).toEqual(before);
  });
});
