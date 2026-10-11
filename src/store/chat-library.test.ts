import { describe, expect, it, vi } from 'vitest';
const current = vi.hoisted(() => ({ get: () => ({} as any) }));
vi.mock('@store/store', () => ({ default: { getState: () => current.get() } }));
import { createChatSlice } from './chat-slice';
import { createBranchSlice } from './branch-slice';
import type { StoreState } from './store';
import type { StoreApi } from 'zustand';
import type { ChatInterface } from '@type/chat';
import { initializeStreamingBuffer, createStreamingContentHash, appendToStreamingBuffer, clearStreamingBuffersForTest } from '@utils/streamingBuffer';
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
  current.get = get;
  const writes: Partial<StoreState>[] = [];
  const set = ((partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    writes.push(patch);
    state = { ...state, ...patch };
  }) as StoreApi<StoreState>['setState'];
  state = { ...createChatSlice(set, get), ...createBranchSlice(set, get),
    captureCurrentNavigationEntry: vi.fn(), pushNavigationEntry: vi.fn(),
    setCurrentChatIndex: vi.fn(index => { state.currentChatIndex = index; }),
    evaluationResults: {}, favoriteModels: [], providerModelCache: {}, providerCustomModels: {}, defaultChatConfig: chat('defaults').config, defaultSystemMessage: '', defaultImageDetail: 'auto',
  } as unknown as StoreState;
  get().setChats([chat('a'), chat('b')]);
  get().ensureBranchTree(0);
  get().ensureBranchTree(1);
  return { get, writes };
};

describe('chat library operations', () => {
  it('duplicates by ID after reorder with shared node IDs and independent content references', () => {
    const { get } = fixture();
    get().setNodeCollapsed({ chatId: get().chats![0].id, nodeId: get().chats![0].branchTree?.activePath[0] ?? '0', value: true });
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

  it.each(['all', 'activePath'] as const)('freezes the current stream for %s duplication', (scope) => {
    clearStreamingBuffersForTest();
    const { get } = fixture();
    const source = get().chats![0];
    const node = source.branchTree!.nodes[source.branchTree!.rootId];
    initializeStreamingBuffer(source.id, node.id, [{ type: 'text', text: 'partial' }]);
    node.contentHash = createStreamingContentHash(source.id, node.id);
    get().duplicateChat({ chatId: source.id, scope });
    const copy = get().chats![0];
    appendToStreamingBuffer(source.id, node.id, ' later');
    const copyHash = copy.branchTree!.nodes[node.id].contentHash;
    expect(copyHash).not.toBe(node.contentHash);
    expect(resolveContent(get().contentStore, copyHash)).toEqual([{ type: 'text', text: 'partial' }]);
    expect(get().contentStore[copyHash].refCount).toBe(1);
    expect(resolveContent(get().contentStore, node.contentHash)).toEqual([{ type: 'text', text: 'partial later' }]);
    clearStreamingBuffersForTest();
  });

  it('clones only the active path when requested and keeps other branches at the source', () => {
    const { get } = fixture();
    const root = get().chats![0].branchTree!.rootId;
    get().createBranch({ chatId: get().chats![0].id, fromNodeId: root, content: [{ type: 'text', text: 'branch' }] });
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

describe('chat removal', () => {
  it('removes only requested IDs, keeps clipboard content, and initializes the final empty library', () => {
    const { get } = fixture();
    const root = get().chats![0].branchTree!.rootId;
    get().copyBranchSequence({ chatId: 'a', fromNodeId: root, toNodeId: root });
    const clipboard = get().branchClipboard;
    const result = get().removeChats({ chatIds: ['a', 'a', 'missing'] });
    expect(result).toEqual({ removedChatIds: ['a'], missingChatIds: ['missing'], selectedChatId: 'b' });
    expect(get().branchClipboard).toBe(clipboard);
    const hash = clipboard!.nodes[root].contentHash;
    expect(resolveContent(get().contentStore, hash)).toEqual([{ type: 'text', text: 'a' }]);
    get().removeChats({ chatIds: ['b'] });
    expect(get().chats).toHaveLength(1);
    expect(get().chats![0].id).not.toBe('b');
    expect(get().chats![0].messages).toEqual([]);
  });
});
