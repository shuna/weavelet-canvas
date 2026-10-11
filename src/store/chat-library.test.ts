import { describe, expect, it, vi } from 'vitest';
import { createChatSlice } from './chat-slice';
import { createBranchSlice } from './branch-slice';
import type { StoreState } from './store';
import type { StoreApi } from 'zustand';
import type { ChatInterface } from '@type/chat';
import { resolveContent } from '@utils/contentStore';
import { readDraggedChatIds } from '../components/Menu/chatHistoryFolderUtils';

const chat = (id: string): ChatInterface => ({
  id, title: id, titleSet: true, imageDetail: 'auto',
  config: { model: 'test', max_tokens: 10, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  messages: [{ role: 'user', content: [{ type: 'text', text: id }] }],
});
const fixture = () => {
  let state: StoreState;
  const get = () => state;
  const writes: Partial<StoreState>[] = [];
  const set = ((partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    writes.push(patch);
    state = { ...state, ...patch };
  }) as StoreApi<StoreState>['setState'];
  state = { ...createChatSlice(set, get), ...createBranchSlice(set, get),
    captureCurrentNavigationEntry: vi.fn(), pushNavigationEntry: vi.fn(),
    setCurrentChatIndex: vi.fn(index => { state.currentChatIndex = index; }),
    evaluationResults: {},
  } as unknown as StoreState;
  get().setChats([chat('a'), chat('b')]);
  get().ensureBranchTree(0);
  get().ensureBranchTree(1);
  return { get, writes };
};

describe('chat library operations', () => {
  it('duplicates by ID after reorder with shared node IDs and independent content references', () => {
    const { get } = fixture();
    get().toggleCollapseNode(0, 0);
    const source = get().chats![0];
    const node = source.branchTree!.nodes[source.branchTree!.rootId];
    const previousEntry = get().contentStore[node.contentHash];
    const beforeCount = previousEntry.refCount;
    get().setChats([...get().chats!].reverse());
    const result = get().duplicateChat({ chatId: 'a', scope: 'all' });
    expect(result.status).toBe('created');
    const copy = get().chats![0];
    expect(copy.id).not.toBe(source.id);
    expect(copy.branchTree).toEqual(source.branchTree);
    expect(copy.branchTree).not.toBe(source.branchTree);
    expect(get().collapsedNodeMaps['0']).toEqual(source.collapsedNodes);
    expect(previousEntry.refCount).toBe(beforeCount);
    expect(get().contentStore[node.contentHash].refCount).toBe(beforeCount + 1);
    expect(get().evaluationResults).toEqual({});
    expect(get().pushNavigationEntry).toHaveBeenCalledTimes(1);
  });

  it('clones only the active path when requested and keeps other branches at the source', () => {
    const { get } = fixture();
    const root = get().chats![0].branchTree!.rootId;
    get().createBranch(0, root, [{ type: 'text', text: 'branch' }]);
    const source = get().chats![0];
    get().duplicateChat({ chatId: 'a', scope: 'activePath' });
    const copy = get().chats![0];
    expect(Object.keys(copy.branchTree!.nodes)).toEqual(source.branchTree!.activePath);
    expect(Object.keys(source.branchTree!.nodes)).toHaveLength(2);
    expect(resolveContent(get().contentStore, Object.values(copy.branchTree!.nodes)[0].contentHash)).toEqual([{ type: 'text', text: 'branch' }]);
  });

  it('renames and detaches a folder without invalidating content undo or copying unaffected chats', () => {
    const { get, writes } = fixture();
    get().upsertMessageAtIndex(0, 0, 'user', [{ type: 'text', text: 'edit' }]);
    const { folderId } = get().createFolder();
    get().moveChatsToFolder({ chatIds: ['a'], folderId, expandDestination: true });
    get().renameChat({ chatId: 'a', title: '' });
    const unchanged = get().chats![1];
    writes.length = 0;
    expect(get().removeFolder({ folderId })).toEqual({ status: 'removed', detachedChatIds: ['a'] });
    expect(writes).toHaveLength(1);
    expect(get().chats![1]).toBe(unchanged);
    expect(get().chats![0].folder).toBeUndefined();
    get().undoBranch();
    expect(get().chats![0].title).toBe('');
    expect(get().chats![0].messages[0].content).toEqual([{ type: 'text', text: 'a' }]);
  });

  it('moves the IDs captured at drag start after reorder and rejects a missing destination atomically', () => {
    const { get, writes } = fixture();
    const { folderId } = get().createFolder();
    const ids = readDraggedChatIds('["a","a","deleted"]')!;
    get().setChats([...get().chats!].reverse());
    writes.length = 0;
    expect(get().moveChatsToFolder({ chatIds: ids, folderId: 'missing', expandDestination: true }).status).toBe('folder-missing');
    expect(writes).toHaveLength(0);
    expect(get().moveChatsToFolder({ chatIds: ids, folderId, expandDestination: true })).toEqual({ status: 'applied', movedChatIds: ['a'], missingChatIds: ['deleted'] });
    expect(writes).toHaveLength(1);
    expect(get().chats!.map(value => value.folder)).toEqual([undefined, folderId]);
    expect(get().folders[folderId].expanded).toBe(true);
    expect(readDraggedChatIds('{bad')).toBeNull();
    expect(readDraggedChatIds('[0]')).toBeNull();
  });
});
