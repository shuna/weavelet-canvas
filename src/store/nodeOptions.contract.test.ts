import { describe, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@hooks/aiTaskLifetime', () => ({ invalidateAiTasks: effects.invalidate }));
vi.mock('uuid', () => ({ v4: () => editingUUID() }));
import { editingUUID, withEditingRuntime } from '../../shared/google-sync/editing';
import { nodeOptions } from '../../shared/google-sync/nodeOptions';
import { setNodeDisplayFieldState } from './branch-domain';
import { setChatNodeMapState } from '../utils/nodeOptions';
import { resolveContent } from '../utils/contentStore';
import { recordChatEdits } from './chat-edit-time';
import { createChatSlice } from './chat-slice';
import { createBranchSlice } from './branch-slice';
import type { StoreState } from './store';
import type { StoreApi } from 'zustand';

const value = { label: '', starred: false, pinned: false, collapsed: false, omitted: false, protected: false };
const flat = () => ({ id: 'target', title: 'Title', titleSet: true, imageDetail: 'auto', config: { model: 'FAKE', max_tokens: 1, temperature: 1, top_p: 1, presence_penalty: 0, frequency_penalty: 0 },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'First', xPart: { opaqueRef: 0 } }], xMessage: { opaqueRef: 1 } },
    { role: 'assistant', content: [{ type: 'text', text: 'Second' }] }], xChat: { opaqueRef: 2 } });
const branched = () => ({ ...flat(), branchTree: { rootId: 'root', activePath: ['root'], xTree: { opaqueRef: 3 }, nodes: {
  root: { id: 'root', role: 'user', parentId: null, contentHash: 'root', createdAt: 1, xNode: { opaqueRef: 4 } },
  inactive: { id: 'inactive', role: 'assistant', parentId: 'root', contentHash: 'inactive', createdAt: 2 },
} }, messages: [{ role: 'user', content: [{ type: 'text', text: 'First', xPart: { opaqueRef: 0 } }], xMessage: { opaqueRef: 1 } }] });
const store = () => ({ root: { content: [{ type: 'text', text: 'First', xPart: { opaqueRef: 0 } }], refCount: 1, xEntry: { opaqueRef: 5 } },
  inactive: { content: [{ type: 'text', text: 'Second' }], refCount: 1 }, unused: { content: [{ type: 'text', text: 'Unused' }], refCount: 0, xEntry: 'keep' } });
function apply(source: any, changes: any[]) {
  const result = structuredClone(source);
  for (const change of changes) {
    let parent = result;
    for (const key of change.path.slice(0, -1)) parent = parent[key];
    const key = change.path.at(-1);
    if (change.op === 'set') parent[key] = change.value;
    else if (change.op === 'remove') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
    else {
      const object = change.path.length ? parent[key] : result;
      const entries = change.keys.map((key: string) => [key, object[key]]);
      Object.keys(object).forEach(key => delete object[key]); Object.assign(object, Object.fromEntries(entries));
    }
  }
  return result;
}
const bridge = (chat: any, nodeId: string, desired = value, contentStore: any = store(), extra = {}) => {
  const response = JSON.parse(nodeOptions(JSON.stringify({ chat, contentStore, operation: 'save', nodeId, value: desired, newIDs: ['new-root', 'new-second'], now: 1000, ...extra })));
  return { response, output: apply({ chat, contentStore }, response.changes) };
};
function state(chat: any, contentStore: any) {
  let state: StoreState;
  const get = () => state;
  const set = ((partial: unknown) => { state = { ...state, ...(typeof partial === 'function' ? (partial as any)(state) : partial) }; }) as StoreApi<StoreState>['setState'];
  state = { ...createChatSlice(set, get), ...createBranchSlice(set, get) } as StoreState;
  state.chats = [structuredClone(chat)]; state.contentStore = structuredClone(contentStore);
  for (const [field, runtime] of [['collapsedNodes', 'collapsedNodeMaps'], ['omittedNodes', 'omittedNodeMaps'], ['protectedNodes', 'protectedNodeMaps']] as const) {
    state[runtime] = chat[field] && Object.keys(chat[field]).length ? { '0': structuredClone(chat[field]) } : {};
  }
  return get;
}

describe('shared node options and actual Web callers', () => {
  it('reads branch options including inactive nodes without changing the source', () => {
    const chat: any = branched(); chat.branchTree.nodes.inactive.label = 'Label'; chat.branchTree.nodes.inactive.starred = true;
    chat.omittedNodes = { inactive: true };
    const before = structuredClone(chat);
    expect(JSON.parse(nodeOptions(JSON.stringify({ chat, contentStore: store(), operation: 'read', nodeId: 'inactive' })))).toEqual({ status: 'read', nodeId: 'inactive', value: { ...value, label: 'Label', starred: true, omitted: true } });
    expect(chat).toEqual(before);
  });
  it('saves six branch values once and preserves unrelated node, entry, chat and tree metadata', () => {
    const chat = branched(), contentStore = store(), before = structuredClone({ chat, contentStore });
    const desired = { label: 'New label', starred: true, pinned: true, collapsed: true, omitted: true, protected: true };
    const { response, output } = bridge(chat, 'inactive', desired, contentStore);
    expect(response.status).toBe('updated'); expect(response.nodeId).toBe('inactive'); expect(response.path).toEqual(['root']);
    expect(output.chat.branchTree.nodes.inactive).toEqual({ ...chat.branchTree.nodes.inactive, label: 'New label', starred: true, pinned: true });
    expect(output.chat.collapsedNodes).toEqual({ inactive: true }); expect(output.chat.omittedNodes).toEqual({ inactive: true }); expect(output.chat.protectedNodes).toEqual({ inactive: true });
    expect(output.chat.branchTree.nodes.root).toEqual(chat.branchTree.nodes.root); expect(output.chat.xChat).toEqual(chat.xChat); expect(output.chat.branchTree.xTree).toEqual(chat.branchTree.xTree);
    expect(output.contentStore).toEqual(contentStore); expect({ chat, contentStore }).toEqual(before);
    const get = state(chat, contentStore);
    withEditingRuntime([], ['root', 'inactive'], 1000, () => {
      expect(get().setNodeLabel({ chatId: chat.id, nodeId: 'inactive', value: desired.label }).status).toBe('updated');
      get().setNodeStar({ chatId: chat.id, nodeId: 'inactive', value: true }); get().setNodePin({ chatId: chat.id, nodeId: 'inactive', value: true });
      get().setNodeCollapsed({ chatId: chat.id, nodeId: 'inactive', value: true }); get().setNodeOmitted({ chatId: chat.id, nodeId: 'inactive', value: true }); get().setNodeProtected({ chatId: chat.id, nodeId: 'inactive', value: true });
    });
    expect(get().chats![0]).toEqual(recordChatEdits([chat] as any, [output.chat], 1000).chats[0]); expect(get().contentStore).toEqual(output.contentStore);
    expect(get().collapsedNodeMaps['0']).toEqual({ inactive: true }); expect(get().omittedNodeMaps['0']).toEqual({ inactive: true }); expect(get().protectedNodeMaps['0']).toEqual({ inactive: true });
    expect(get().branchHistoryPast).toHaveLength(3);
    expect(effects.invalidate).toHaveBeenCalledWith([chat.id], ['inactive']);
  });
  it('removes empty display fields and false map keys by the same Web rules', () => {
    const chat: any = branched(); Object.assign(chat.branchTree.nodes.root, { label: 'Old', starred: true, pinned: true });
    chat.collapsedNodes = { root: true, inactive: true }; chat.omittedNodes = { root: true }; chat.protectedNodes = { root: true };
    const output = bridge(chat, 'root').output;
    expect(output.chat.branchTree.nodes.root).not.toHaveProperty('label'); expect(output.chat.branchTree.nodes.root).not.toHaveProperty('starred'); expect(output.chat.branchTree.nodes.root).not.toHaveProperty('pinned');
    expect(output.chat.collapsedNodes).toEqual({ inactive: true }); expect(output.chat.omittedNodes).toEqual({}); expect(output.chat.protectedNodes).toEqual({});
  });
  it('keeps flat map-only edits numeric and no-op edits flat without requesting UUIDs', () => {
    const chat = flat(), contentStore = store();
    const none = bridge(chat, '0', value, contentStore, { newIDs: [] });
    expect(none.response.status).toBe('unchanged'); expect(none.response.changes).toEqual([]); expect(none.output.chat).toEqual(chat);
    const maps = bridge(chat, '0', { ...value, collapsed: true, omitted: true, protected: true }, contentStore, { newIDs: [] });
    expect(maps.output.chat).not.toHaveProperty('branchTree'); expect(maps.output.chat.omittedNodes).toEqual({ '0': true });
    const get = state(chat, contentStore);
    withEditingRuntime([], [], 1000, () => { get().setNodeCollapsed({ chatId: chat.id, nodeId: '0', value: true }); get().setNodeOmitted({ chatId: chat.id, nodeId: '0', value: true }); get().setNodeProtected({ chatId: chat.id, nodeId: '0', value: true }); });
    expect(get().chats![0]).toEqual(recordChatEdits([chat] as any, [maps.output.chat], 1000).chats[0]); expect(get().branchHistoryPast).toHaveLength(0);
  });
  it('uses actual flat conversion, remaps index flags and retains message attributes/body metadata', () => {
    const chat: any = flat(); chat.omittedNodes = { '0': true }; chat.protectedNodes = { '0': true }; chat.collapsedNodes = { '0': true };
    const contentStore = store(), desired = { label: 'Label', starred: true, pinned: true, collapsed: true, omitted: true, protected: true };
    const { response, output } = bridge(chat, '0', desired, contentStore);
    expect(response.nodeId).toBe('new-root'); expect(response.path).toEqual(['new-root', 'new-second']);
    expect(output.chat.omittedNodes).toEqual({ 'new-root': true }); expect(output.chat.protectedNodes).toEqual({ 'new-root': true }); expect(output.chat.collapsedNodes).toEqual({ 'new-root': true });
    expect(output.chat.branchTree.messageAttributesV1.byNode['new-root']).toEqual({ xMessage: { opaqueRef: 1 } });
    expect(resolveContent(output.contentStore, output.chat.branchTree.nodes['new-root'].contentHash)).toEqual(chat.messages[0].content);
    expect(output.contentStore.unused).toEqual(contentStore.unused);
  });
  it('keeps untouched imported false display/map values instead of canonicalizing all six fields', () => {
    const chat: any = branched(); chat.branchTree.nodes.root.pinned = false; chat.collapsedNodes = { root: false };
    const noop = bridge(chat, 'root'); expect(noop.response.status).toBe('unchanged'); expect(noop.output.chat).toEqual(chat);
    const changed = bridge(chat, 'root', { ...value, label: 'Label' });
    expect(changed.output.chat.branchTree.nodes.root.pinned).toBe(false);
    expect(changed.output.chat.collapsedNodes).toEqual({ root: false });
  });

  it('uses map all operations without changing their active-path-only semantics', () => {
    const chat: any = branched(); chat.omittedNodes = { inactive: true };
    const result = setChatNodeMapState([chat], { chatId: chat.id, value: true }, 'omittedNodes');
    expect(result.status).toBe('updated'); if (result.status === 'updated') expect(result.map).toEqual({ root: true });
    const get = state(chat, store()); get().setAllOmitted({ chatId: chat.id, value: true });
    expect(get().chats![0].omittedNodes).toEqual({ root: true }); expect(get().omittedNodeMaps['0']).toEqual({ root: true });
    get().setAllOmitted({ chatId: chat.id, value: false }); expect(get().chats![0].omittedNodes).toEqual({});
  });
  it('rejects missing targets and noncanonical flat indices without effects', () => {
    expect(setNodeDisplayFieldState(undefined, { chatId: 'missing', nodeId: '0' }, 'label', 'Label', {})).toEqual({ status: 'chat-missing' });
    expect(setChatNodeMapState(undefined, { chatId: 'missing', nodeId: '0', value: true }, 'omittedNodes')).toEqual({ status: 'missing' });
    for (const id of ['missing', '-1', '01', 'message-0']) {
      const result = bridge(flat(), id);
      expect(result.response).toEqual({ status: 'node-missing', changes: [] });
    }
  });
  it('restores the UUID/date runtime on insufficient and duplicate IDs', () => {
    const clock = Date.now;
    for (const newIDs of [[], ['same', 'same']]) {
      expect(() => bridge(flat(), '0', { ...value, starred: true }, store(), { newIDs })).toThrow('Invalid new node ID.');
      expect(Date.now).toBe(clock);
    }
    const converted = bridge(flat(), '0', { ...value, starred: true }); expect(converted.response.status).toBe('updated');
  });
});
