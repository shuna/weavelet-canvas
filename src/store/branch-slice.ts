import { captureBranchHistory, invalidateBranchHistory, stepBranchHistory, canStepBranchHistory, type BranchSnapshot } from '@utils/branchHistory';
import { invalidateAiTasks } from '@hooks/aiTaskLifetime';
import i18next from 'i18next';
import { StoreSlice, StoreState } from './store';
import {
  BranchClipboard,
  ChatInterface,
  ChatView,
  ContentInterface,
  GeneratingSession,
  Role,
  isSplitView,
} from '@type/chat';
import { ContentStoreData, addContent } from '@utils/contentStore';
import { materializeActivePath } from '@utils/branchUtils';
import { showToast } from '@utils/showToast';
import {
  finalizeStreamingBuffer,
  getStreamingTargetFromHash,
  peekBufferedContent,
  isStreamingContentHash,
} from '@utils/streamingBuffer';
import {
  appendNodeToActivePathState,
  copyBranchSequenceState,
  createBranchState,
  pruneHiddenNodesState,
  ensureBranchTreeState,
  insertNodeState,
  moveNodeState,
  replaceNodeAndPruneState,
  deleteNodeBranchState,
  pasteBranchSequenceState,
  removeMessageAtIndexState,
  removeNodeState,
  removeBranchSequenceState,
  setNodeDisplayFieldState,
  resolveNodeTarget,
  switchActivePathState,
  switchBranchAtNodeState,
  truncateActivePathState,
  updateNodeRoleState,
  upsertMessageAtIndexState,
  upsertWithAutoBranchState,
  updateLastNodeContentState,
} from './branch-domain';
import { cloneChatAt } from './branch-domain';
import { recordChatEdits } from './chat-edit-time';

/**
 * Finalize any streaming nodes in the given chat, mutating contentStore in place.
 * Returns updated chats array if any streaming nodes were found, otherwise the original.
 *
 * Nodes that are actively being streamed by an SSE session (present in
 * `generatingSessions`) are **skipped** so that the in-flight streaming buffer
 * is not prematurely destroyed.  `resolveContent` already handles streaming
 * content hashes by reading directly from the buffer, so callers such as
 * `materializeActivePath` work correctly without eager finalization.
 */
function finalizeStreamingNodesInChat(
  chats: ChatInterface[],
  chatIndex: number,
  contentStore: ContentStoreData,
  generatingSessions?: Record<string, GeneratingSession>
): ChatInterface[] {
  const chat = chats[chatIndex];
  const tree = chat.branchTree;
  if (!tree) return chats;

  // Build set of node IDs with an active SSE session so we can skip them.
  const activeNodeIds: Set<string> | undefined = generatingSessions
    ? new Set(
        Object.values(generatingSessions)
          .filter((s) => s.chatId === chat.id)
          .map((s) => s.targetNodeId)
      )
    : undefined;

  const streamingNodes = Object.values(tree.nodes).filter(
    (n) =>
      isStreamingContentHash(n.contentHash) &&
      !(activeNodeIds?.has(n.id))
  );
  if (streamingNodes.length === 0) return chats;

  const updatedChats = cloneChatAt(chats, chatIndex);
  const updatedTree = updatedChats[chatIndex].branchTree!;
  for (const node of streamingNodes) {
    const content = finalizeStreamingBuffer(chat.id, node.id);
    updatedTree.nodes[node.id] = {
      ...updatedTree.nodes[node.id],
      contentHash: addContent(contentStore, content),
    };
  }
  return updatedChats;
}

/** @visibleForTesting */
export { finalizeStreamingNodesInChat as _finalizeStreamingNodesInChat };

export interface PendingChatFocus {
  chatIndex: number;
  nodeId: string;
}

export interface ScrollAnchor {
  firstVisibleItemIndex: number;
  offsetWithinItem: number;
  wasAtBottom: boolean;
}

const withRuntimeFlatNodeMaps = (chats: ChatInterface[] | undefined, state: StoreState) => chats?.map((chat, index) => {
  if (chat.branchTree) return chat;
  const key = String(index);
  return { ...chat, collapsedNodes: state.collapsedNodeMaps[key] ?? chat.collapsedNodes,
    omittedNodes: state.omittedNodeMaps[key] ?? chat.omittedNodes, protectedNodes: state.protectedNodeMaps[key] ?? chat.protectedNodes };
});

type SequenceRange = { chatId: string; fromNodeId: string; toNodeId: string };
type SequenceFailure = { status: 'missing' | 'not-ancestor' | 'invalid-target' | 'content-missing' };

const validateSequenceRange = (chats: ChatInterface[] | undefined, input: SequenceRange) => {
  const chatIndex = chats?.findIndex((chat) => chat.id === input.chatId) ?? -1;
  const tree = chats?.[chatIndex]?.branchTree;
  if (!tree?.nodes[input.fromNodeId] || !tree.nodes[input.toNodeId]) {
    return { status: 'missing' as const };
  }
  const clipboard = copyBranchSequenceState(chats!, chatIndex, input.fromNodeId, input.toNodeId);
  if (!clipboard) return { status: 'not-ancestor' as const };
  return { status: 'valid' as const, chatIndex, clipboard };
};

const hasClipboardContent = (clipboard: BranchClipboard, contentStore: ContentStoreData) =>
  clipboard.nodeIds.length > 0 && clipboard.nodeIds.every((id) => {
    const node = clipboard.nodes[id];
    if (!node) return false;
    const target = getStreamingTargetFromHash(node.contentHash);
    if (target) return peekBufferedContent(target.chatId, target.nodeId) !== undefined;
    let hash: string | undefined = node.contentHash;
    const visited = new Set<string>();
    while (hash) {
      if (visited.has(hash) || !contentStore[hash]) return false;
      visited.add(hash);
      hash = contentStore[hash].delta?.baseHash;
    }
    return true;
  });

type NodeTarget = { chatId: string; nodeId: string };
type NodeEdit = NodeTarget & { role: Role; content: ContentInterface[] };
type NodeResult = { status: 'updated' | 'unchanged' | 'chat-missing' | 'node-missing' | 'invalid-target' | 'protected' | 'busy' };

export interface BranchSlice {
  contentStore: ContentStoreData;
  setContentStore: (contentStore: ContentStoreData) => void;
  applyBranchState: (
    chats: ChatInterface[],
    contentStore: ContentStoreData,
    options?: { recordHistory?: boolean; clipboard?: BranchClipboard; historyBase?: { chats: ChatInterface[]; contentStore: ContentStoreData } }
  ) => void;
  invalidateBranchHistory: (chatIds: string[]) => void;
  branchHistoryPast: BranchSnapshot[];
  branchHistoryFuture: BranchSnapshot[];
  undoBranch: () => void;
  redoBranch: () => void;
  canUndoBranch: () => boolean;
  canRedoBranch: () => boolean;
  branchClipboard: BranchClipboard | null;
  branchEditorFocusNodeId: string | null;
  setBranchEditorFocusNodeId: (nodeId: string | null) => void;
  hoveredNodeId: string | null;
  setHoveredNodeId: (nodeId: string | null) => void;
  visibleNodeId: string | null;
  setVisibleNodeId: (nodeId: string | null) => void;
  branchEditorSyncEnabled: boolean;
  setBranchEditorSyncEnabled: (enabled: boolean) => void;
  chatActiveView: ChatView;
  setChatActiveView: (view: ChatView) => void;
  navigateToBranchEditor: () => void;
  pendingChatFocus: PendingChatFocus | null;
  setPendingChatFocus: (focus: PendingChatFocus | null) => void;
  clearPendingChatFocus: () => void;

  chatScrollAnchors: Record<string, ScrollAnchor>;
  saveChatScrollAnchor: (chatId: string, anchor: ScrollAnchor) => void;
  getChatScrollAnchor: (chatId: string) => ScrollAnchor | null;
  clearChatScrollAnchor: (chatId: string) => void;

  // Multi-view state
  isMultiView: boolean;
  setIsMultiView: (enabled: boolean) => void;
  multiViewChatIndices: number[];
  setMultiViewChatIndices: (indices: number[]) => void;
  multiViewPrimaryChatIndex: number | null;
  setMultiViewPrimaryChatIndex: (index: number | null) => void;
  moveBranchSequence: (input: {
    sourceChatId: string; fromNodeId: string; toNodeId: string;
    targetChatId: string; afterNodeId: string;
  }) => { status: 'moved'; nodeIds: string[] } | SequenceFailure;
  cutBranchSequence: (input: SequenceRange) => { status: 'cut' } | SequenceFailure;
  activateFolderOverview: (folderId: string) => void;

  compareTarget: { chatIndex: number; nodeId: string } | null;
  setCompareTarget: (target: { chatIndex: number; nodeId: string } | null) => void;

  saveNode: (input: NodeEdit) => NodeResult;
  appendNode: (input: { chatId: string; role: Role; content: ContentInterface[] }) => { status: 'updated'; nodeId: string } | { status: 'chat-missing' };
  insertNode: (input: { chatId: string; beforeNodeId: string | null; role: Role; content: ContentInterface[] }) => { status: 'updated'; nodeId: string } | { status: 'chat-missing' | 'node-missing' | 'invalid-target' };
  removeNode: (input: NodeTarget) => NodeResult;
  moveNode: (input: NodeTarget & { direction: 'up' | 'down' }) => NodeResult;
  replaceNodeAndPrune: (input: NodeEdit & { removeCount: number }) => { status: 'updated' | 'missing' | 'invalid-input' | 'protected'; blockedNodeIds?: string[]; removedNodeIds: string[]; pruneBlockedBy: string[] };
  updateNodeRole: (input: NodeTarget & { role: Role }) => NodeResult;
  setNodeStar: (input: NodeTarget & { value: boolean }) => NodeResult;
  setNodePin: (input: NodeTarget & { value: boolean }) => NodeResult;
  setNodeLabel: (input: NodeTarget & { value: string }) => NodeResult;

  ensureBranchTree: (chatIndex: number) => void;
  createBranch: (input: { chatId: string; fromNodeId: string; content?: ContentInterface[] }) =>
    { status: 'created'; nodeId: string } | { status: 'chat-missing' | 'node-missing' };
  switchBranchAtNode: (chatIndex: number, nodeId: string) => void;
  switchActivePath: (chatIndex: number, newPath: string[]) => void;
  switchActivePathSilent: (chatIndex: number, newPath: string[]) => void;
  deleteBranch: (chatIndex: number, nodeId: string) => {status: 'updated' | 'protected' | 'chat-missing' | 'node-missing' | 'invalid-target'; blockedNodeIds?: string[]};
  pruneHiddenNodes: (chatIndex: number) => void;
  updateLastNodeContent: (
    chatIndex: number,
    content: ContentInterface[]
  ) => void;
  truncateActivePathAt: (chatIndex: number, nodeId: string) => void;
  upsertMessageAtIndex: (
    chatIndex: number,
    messageIndex: number,
    role: Role,
    content: ContentInterface[]
  ) => void;
  removeMessageAtIndex: (chatIndex: number, messageIndex: number) => void;

  copyBranchSequence: (input: SequenceRange) => { status: 'copied' } | { status: 'missing' | 'not-ancestor' };
  pasteBranchSequence: (input: { chatId: string; afterNodeId: string }) =>
    { status: 'pasted'; nodeIds: string[] } | { status: 'missing' | 'clipboard-empty' | 'content-missing' };
  setBranchClipboard: (clipboard: BranchClipboard | null) => void;
}

export const createBranchSlice: StoreSlice<BranchSlice> = (set, get) => {
  const setNodeField = (input: NodeTarget, field: 'label' | 'starred' | 'pinned', value: string | true | undefined): NodeResult => {
    const result = setNodeDisplayFieldState(withRuntimeFlatNodeMaps(get().chats, get()), input, field, value, get().contentStore);
    if (result.status !== 'updated') return result;
    get().applyBranchState(result.chats, result.contentStore, { historyBase: result.historyBase });
    return { status: 'updated' };
  };
  return ({
  contentStore: {},
  setContentStore: (contentStore) => {
    set({ contentStore });
  },
  applyBranchState: (chats, contentStore, options) => {
    const prevChats = get().chats;
    const now = Date.now();
    const edits = recordChatEdits(prevChats, chats, now);
    chats = edits.chats;
    // Legacy tree creation has no undo step; record the edit against that prepared tree.
    const historyChats = options?.historyBase?.chats ?? prevChats;
    const historyStore = options?.historyBase?.contentStore ?? get().contentStore;
    const previousHistory = {past: get().branchHistoryPast, future: get().branchHistoryFuture};
    const nextHistory = options?.recordHistory !== false && prevChats
      ? captureBranchHistory(previousHistory, {chats: historyChats!, contentStore: historyStore}, {chats, contentStore}) : previousHistory;
    const history = nextHistory === previousHistory ? {} : {branchHistoryPast: nextHistory.past, branchHistoryFuture: nextHistory.future};
    const clipboard = options?.clipboard ? { branchClipboard: options.clipboard } : {};
    const sameOrder = prevChats?.length === chats.length &&
      prevChats.every((chat, index) => chat.id === chats[index].id);
    if (!sameOrder) {
      get().setChats(chats, { preserveBranchHistory: true });
    }
    const attributes: Partial<StoreState> = {};
    for (const [field, runtime] of [
      ['collapsedNodes', 'collapsedNodeMaps'], ['omittedNodes', 'omittedNodeMaps'], ['protectedNodes', 'protectedNodeMaps'],
    ] as const) {
      const changed = chats.filter((chat, index) => chat[field] !== prevChats?.[index]?.[field]);
      if (sameOrder && changed.length) {
        attributes[runtime] = { ...get()[runtime] };
        for (const chat of changed) attributes[runtime]![String(chats.indexOf(chat))] = chat[field] ?? {};
      }
    }
    set({ chats, contentStore, ...history, ...clipboard, ...attributes,
      ...(edits.changed ? { lastContentEditedAt: now } : {}),
    });
    if (options?.recordHistory !== false) {
      for (const previous of prevChats ?? []) {
        const next = chats.find(chat => chat.id === previous.id);
        if (!next || previous.config.systemPrompt !== next.config.systemPrompt) {
          invalidateAiTasks([previous.id]);
          continue;
        }
        const changedNodes = Object.values(previous.branchTree?.nodes ?? {}).filter(node => {
          const updated = next.branchTree?.nodes[node.id];
          return !updated || node.contentHash !== updated.contentHash || node.role !== updated.role;
        }).map(node => node.id);
        if (changedNodes.length) invalidateAiTasks([previous.id], changedNodes);
      }
    }
  },
  invalidateBranchHistory: (chatIds) => {
    if (!chatIds.length) return;
    const history = invalidateBranchHistory({past:get().branchHistoryPast,future:get().branchHistoryFuture},chatIds);
    set({branchHistoryPast:history.past,branchHistoryFuture:history.future});
  },
  branchHistoryPast: [],
  branchHistoryFuture: [],
  undoBranch: () => {
    const state = get();
    if (!state.chats) return;
    const result = stepBranchHistory({past:state.branchHistoryPast,future:state.branchHistoryFuture},
      {chats:state.chats,contentStore:state.contentStore}, 'undo', Object.values(state.generatingSessions).map(session=>session.chatId));
    if (result.status !== 'updated') return;
    set({branchHistoryPast:result.history.past,branchHistoryFuture:result.history.future});
    get().setChats(result.state.chats, {preserveBranchHistory:true});
    set({contentStore:result.state.contentStore});
    invalidateAiTasks(result.affectedChatIds);
  },
  canUndoBranch: () => canStepBranchHistory({past:get().branchHistoryPast,future:get().branchHistoryFuture}, 'undo', Object.values(get().generatingSessions).map(session=>session.chatId)),
  redoBranch: () => {
    const state = get();
    if (!state.chats) return;
    const result = stepBranchHistory({past:state.branchHistoryPast,future:state.branchHistoryFuture},
      {chats:state.chats,contentStore:state.contentStore}, 'redo', Object.values(state.generatingSessions).map(session=>session.chatId));
    if (result.status !== 'updated') return;
    set({branchHistoryPast:result.history.past,branchHistoryFuture:result.history.future});
    get().setChats(result.state.chats, {preserveBranchHistory:true});
    set({contentStore:result.state.contentStore});
    invalidateAiTasks(result.affectedChatIds);
  },
  canRedoBranch: () => canStepBranchHistory({past:get().branchHistoryPast,future:get().branchHistoryFuture}, 'redo', Object.values(get().generatingSessions).map(session=>session.chatId)),
  branchClipboard: null,
  branchEditorFocusNodeId: null,
  setBranchEditorFocusNodeId: (nodeId) => {
    if (get().branchEditorFocusNodeId === nodeId) return;
    set({ branchEditorFocusNodeId: nodeId });
  },
  hoveredNodeId: null,
  setHoveredNodeId: (nodeId) => {
    if (get().hoveredNodeId === nodeId) return;
    set({ hoveredNodeId: nodeId });
  },
  visibleNodeId: null,
  setVisibleNodeId: (nodeId) => {
    if (get().visibleNodeId === nodeId) return;
    set({ visibleNodeId: nodeId });
  },
  branchEditorSyncEnabled: true,
  setBranchEditorSyncEnabled: (enabled) => {
    if (get().branchEditorSyncEnabled === enabled) return;
    set({ branchEditorSyncEnabled: enabled });
  },
  chatActiveView: 'chat' as ChatView,
  setChatActiveView: (view) => {
    if (get().chatActiveView === view) return;
    set({ chatActiveView: view });
  },
  navigateToBranchEditor: () => {
    const current = get().chatActiveView;
    if (current === 'branch-editor') return;
    if (isSplitView(current)) {
      // On desktop, branch editor is already visible in split — just focus
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      if (isDesktop) return;
    }
    set({ chatActiveView: 'branch-editor' });
  },
  pendingChatFocus: null,
  setPendingChatFocus: (focus) => {
    set({ pendingChatFocus: focus });
  },
  clearPendingChatFocus: () => {
    if (get().pendingChatFocus === null) return;
    set({ pendingChatFocus: null });
  },

  chatScrollAnchors: {},
  saveChatScrollAnchor: (chatId, anchor) => {
    set((prev) => ({
      chatScrollAnchors: { ...prev.chatScrollAnchors, [chatId]: anchor },
    }));
  },
  getChatScrollAnchor: (chatId) => {
    return get().chatScrollAnchors[chatId] ?? null;
  },
  clearChatScrollAnchor: (chatId) => {
    const { [chatId]: _, ...rest } = get().chatScrollAnchors;
    set({ chatScrollAnchors: rest });
  },

  compareTarget: null,
  setCompareTarget: (target) => {
    set({ compareTarget: target });
  },

  isMultiView: false,
  setIsMultiView: (enabled) => {
    if (get().isMultiView === enabled && (enabled || (
      get().multiViewChatIndices.length === 0 &&
      get().multiViewPrimaryChatIndex === null
    ))) return;
    set({ isMultiView: enabled });
    if (!enabled) {
      set({ multiViewChatIndices: [], multiViewPrimaryChatIndex: null });
    }
  },
  multiViewChatIndices: [],
  setMultiViewChatIndices: (indices) => {
    const current = get().multiViewChatIndices;
    if (
      current.length === indices.length &&
      current.every((value, index) => value === indices[index])
    ) {
      return;
    }
    set({ multiViewChatIndices: indices });
  },
  multiViewPrimaryChatIndex: null,
  setMultiViewPrimaryChatIndex: (index) => {
    if (get().multiViewPrimaryChatIndex === index) return;
    set({ multiViewPrimaryChatIndex: index });
  },
  moveBranchSequence: (input) => {
    const chats = get().chats;
    const range = validateSequenceRange(chats, { ...input, chatId: input.sourceChatId });
    if (range.status !== 'valid') return range;
    const targetIndex = chats!.findIndex((chat) => chat.id === input.targetChatId);
    if (!chats![targetIndex]?.branchTree?.nodes[input.afterNodeId]) return { status: 'missing' };
    if (range.chatIndex === targetIndex && range.clipboard.nodeIds.includes(input.afterNodeId)) {
      return { status: 'invalid-target' };
    }
    if (!hasClipboardContent(range.clipboard, get().contentStore)) return { status: 'content-missing' };
    const removed = removeBranchSequenceState(chats!, range.chatIndex, range.clipboard.nodeIds, get().contentStore);
    const pasted = pasteBranchSequenceState(removed.chats, targetIndex, input.afterNodeId, range.clipboard, removed.contentStore);
    const nodeIds = pasted.chats[targetIndex].branchTree!.activePath.slice(-range.clipboard.nodeIds.length);
    get().applyBranchState(pasted.chats, pasted.contentStore, { clipboard: range.clipboard });
    return { status: 'moved', nodeIds };
  },
  cutBranchSequence: (input) => {
    const range = validateSequenceRange(get().chats, input);
    if (range.status !== 'valid') return range;
    if (!hasClipboardContent(range.clipboard, get().contentStore)) return { status: 'content-missing' };
    const removed = removeBranchSequenceState(get().chats!, range.chatIndex, range.clipboard.nodeIds, get().contentStore);
    get().applyBranchState(removed.chats, removed.contentStore, { clipboard: range.clipboard });
    return { status: 'cut' };
  },
  activateFolderOverview: (folderId) => {
    const chats = withRuntimeFlatNodeMaps(get().chats, get());
    if (!chats) return;
    const indices = chats
      .map((c, i) => ({ chat: c, index: i }))
      .filter((item) => item.chat.folder === folderId)
      .map((item) => item.index);
    set({
      isMultiView: true,
      multiViewChatIndices: indices,
      multiViewPrimaryChatIndex: get().currentChatIndex,
    });
  },

  updateNodeRole: (input) => {
    const target = resolveNodeTarget(withRuntimeFlatNodeMaps(get().chats, get()), input);
    if (target.status !== 'valid') return target;
    const currentRole = target.chat.branchTree?.nodes[input.nodeId]?.role ?? target.chat.messages[target.messageIndex]?.role;
    if (currentRole === input.role) return { status: 'unchanged' };
    const ensured = ensureBranchTreeState(withRuntimeFlatNodeMaps(get().chats, get())!, target.chatIndex, get().contentStore);
    const nodeId = target.chat.branchTree ? input.nodeId : ensured.chats[target.chatIndex].branchTree!.activePath[target.messageIndex];
    const chats = updateNodeRoleState(ensured.chats, target.chatIndex, nodeId, input.role, ensured.contentStore);
    get().applyBranchState(chats, ensured.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  },
  setNodeStar: (input) => setNodeField(input, 'starred', input.value || undefined),
  setNodePin: (input) => setNodeField(input, 'pinned', input.value || undefined),
  setNodeLabel: (input) => setNodeField(input, 'label', input.value || undefined),
  saveNode: (input) => {
    const target = resolveNodeTarget(withRuntimeFlatNodeMaps(get().chats, get()), input, true);
    if (target.status !== 'valid') return target;
    if ((target.chat.protectedNodes ?? {})[input.nodeId]) return { status: 'protected' };
    if (Object.values(get().generatingSessions).some(session => session.chatId === input.chatId && session.targetNodeId === input.nodeId)) return { status: 'busy' };
    const ensured = ensureBranchTreeState(withRuntimeFlatNodeMaps(get().chats, get())!, target.chatIndex, get().contentStore);
    const result = upsertWithAutoBranchState(ensured.chats, target.chatIndex, target.messageIndex, { role: input.role, content: input.content }, ensured.contentStore);
    if (result.noOp) return { status: 'unchanged' };
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  },
  appendNode: (input) => {
    const chatIndex = get().chats?.findIndex(chat => chat.id === input.chatId) ?? -1;
    if (chatIndex < 0) return { status: 'chat-missing' };
    const ensured = ensureBranchTreeState(withRuntimeFlatNodeMaps(get().chats, get())!, chatIndex, get().contentStore);
    const result = appendNodeToActivePathState(ensured.chats, chatIndex, input.role, input.content, ensured.contentStore);
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated', nodeId: result.newId };
  },
  insertNode: (input) => {
    const result = insertNodeState(withRuntimeFlatNodeMaps(get().chats, get()), input, get().contentStore);
    if (result.status !== 'updated') return result;
    get().applyBranchState(result.chats, result.contentStore, { historyBase: result.historyBase });
    return { status: 'updated', nodeId: result.nodeId };
  },
  removeNode: (input) => {
    const preserveNode = Object.values(get().generatingSessions).some(session => session.chatId === input.chatId && session.targetNodeId === input.nodeId);
    const result = removeNodeState(withRuntimeFlatNodeMaps(get().chats, get()), input, get().contentStore, { preserveNode });
    if (result.status !== 'updated') return result;
    get().applyBranchState(result.chats, result.contentStore, { historyBase: result.historyBase });
    return { status: 'updated' };
  },
  moveNode: (input) => {
    const result = moveNodeState(withRuntimeFlatNodeMaps(get().chats,get()),input,get().contentStore);
    if (result.status !== 'updated') return result;
    get().applyBranchState(result.chats,result.contentStore,{historyBase:result.historyBase});
    return {status:'updated'};
  },
  replaceNodeAndPrune: (input) => {
    const result = replaceNodeAndPruneState(withRuntimeFlatNodeMaps(get().chats,get()),input,get().contentStore);
    if (result.status !== 'updated') return result;
    get().applyBranchState(result.chats,result.contentStore,{historyBase:result.historyBase});
    return {status:'updated',removedNodeIds:result.removedNodeIds,pruneBlockedBy:result.pruneBlockedBy};
  },

  ensureBranchTree: (chatIndex) => {
    const chats = withRuntimeFlatNodeMaps(get().chats, get());
    if (!chats || chats[chatIndex]?.branchTree) return;
    const { chats: updatedChats, contentStore } = ensureBranchTreeState(
      chats,
      chatIndex,
      get().contentStore
    );
    get().applyBranchState(updatedChats, contentStore, { recordHistory: false });
  },

  createBranch: (input) => {
    const target = resolveNodeTarget(withRuntimeFlatNodeMaps(get().chats, get()), { chatId: input.chatId, nodeId: input.fromNodeId });
    if (target.status !== 'valid') return { status: target.status === 'chat-missing' ? 'chat-missing' : 'node-missing' };
    const ensured = ensureBranchTreeState(withRuntimeFlatNodeMaps(get().chats, get())!, target.chatIndex, get().contentStore);
    const nodeId = target.chat.branchTree ? input.fromNodeId : ensured.chats[target.chatIndex].branchTree!.activePath[target.messageIndex];
    const result = createBranchState(ensured.chats, target.chatIndex, nodeId, input.content, ensured.contentStore);
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'created', nodeId: result.newId };
  },

  switchBranchAtNode: (chatIndex, nodeId) => {
    const contentStore = { ...get().contentStore };
    const sessions = get().generatingSessions;
    const chats = finalizeStreamingNodesInChat(get().chats!, chatIndex, contentStore, sessions);
    get().applyBranchState(
      switchBranchAtNodeState(chats, chatIndex, nodeId, contentStore),
      contentStore,
      { recordHistory: false }
    );
  },

  switchActivePath: (chatIndex, newPath) => {
    const contentStore = { ...get().contentStore };
    const sessions = get().generatingSessions;
    const chats = finalizeStreamingNodesInChat(get().chats!, chatIndex, contentStore, sessions);
    get().applyBranchState(
      switchActivePathState(chats, chatIndex, newPath, contentStore),
      contentStore,
      { recordHistory: false }
    );
  },

  switchActivePathSilent: (chatIndex, newPath) => {
    const contentStore = { ...get().contentStore };
    const sessions = get().generatingSessions;
    const chats = finalizeStreamingNodesInChat(get().chats!, chatIndex, contentStore, sessions);
    const updated = switchActivePathState(chats, chatIndex, newPath, contentStore);
    get().setChats(updated, { preserveBranchHistory: true });
    set({ contentStore });
  },

  deleteBranch: (chatIndex, nodeId) => {
    const chats = withRuntimeFlatNodeMaps(get().chats,get());
    if (!chats?.[chatIndex]) return {status:'chat-missing'};
    const result = deleteNodeBranchState(chats,{chatId:chats[chatIndex].id,nodeId},get().contentStore);
    if (result.status !== 'updated') return result;
    get().applyBranchState(result.chats,result.contentStore,{historyBase:result.historyBase});
    return {status:'updated'};
  },

  pruneHiddenNodes: (chatIndex) => {
    const contentStore = { ...get().contentStore };
    const sessions = get().generatingSessions;
    const chats = finalizeStreamingNodesInChat(get().chats!, chatIndex, contentStore, sessions);
    // Ensure runtime protectedNodeMaps are reflected on the chat object
    // so pruneHiddenNodesState can see them.
    const mapKey = String(chatIndex);
    const runtimeProtected = get().protectedNodeMaps[mapKey];
    if (runtimeProtected && chats[chatIndex]) {
      chats[chatIndex] = { ...chats[chatIndex], protectedNodes: runtimeProtected };
    }
    const result = pruneHiddenNodesState(
      chats,
      chatIndex,
      contentStore
    );
    get().applyBranchState(result.chats, result.contentStore);
  },

  updateLastNodeContent: (chatIndex, content) => {
    const { chats, contentStore } = updateLastNodeContentState(
      withRuntimeFlatNodeMaps(get().chats, get())!,
      chatIndex,
      content,
      get().contentStore
    );
    get().applyBranchState(chats, contentStore);
  },

  truncateActivePathAt: (chatIndex, nodeId) => {
    get().setChats(
      truncateActivePathState(get().chats!, chatIndex, nodeId, get().contentStore)
    );
  },

  upsertMessageAtIndex: (chatIndex, messageIndex, role, content) => {
    const { chats, contentStore } = upsertMessageAtIndexState(
      withRuntimeFlatNodeMaps(get().chats, get())!,
      chatIndex,
      messageIndex,
      { role, content },
      get().contentStore
    );
    get().applyBranchState(chats, contentStore);
  },

  removeMessageAtIndex: (chatIndex, messageIndex) => {
    const chat = get().chats?.[chatIndex];
    // Block deletion of protected nodes
    const resolvedNodeId = chat?.branchTree?.activePath?.[messageIndex] ?? String(messageIndex);
    const mapKey = String(chatIndex);
    const protectedNodes = get().protectedNodeMaps[mapKey] ?? chat?.protectedNodes ?? {};
    if (protectedNodes[resolvedNodeId]) {
      showToast(i18next.t('protectedCannotDelete', { ns: 'main' }), 'warning');
      return;
    }

    const nodeId = chat?.branchTree?.activePath?.[messageIndex];
    const preserveNode = !!nodeId && Object.values(get().generatingSessions).some(
      (session) => session.chatId === chat?.id && session.targetNodeId === nodeId
    );
    const { chats, contentStore } = removeMessageAtIndexState(
      withRuntimeFlatNodeMaps(get().chats, get())!,
      chatIndex,
      messageIndex,
      get().contentStore,
      { preserveNode }
    );
    get().applyBranchState(chats, contentStore);
  },

  copyBranchSequence: (input) => {
    const range = validateSequenceRange(get().chats, input);
    if (range.status !== 'valid') return range;
    set({ branchClipboard: range.clipboard });
    return { status: 'copied' };
  },

  pasteBranchSequence: (input) => {
    const chats = get().chats;
    const chatIndex = chats?.findIndex((chat) => chat.id === input.chatId) ?? -1;
    if (!chats?.[chatIndex]?.branchTree?.nodes[input.afterNodeId]) return { status: 'missing' };
    const clipboard = get().branchClipboard;
    if (!clipboard) return { status: 'clipboard-empty' };
    if (!hasClipboardContent(clipboard, get().contentStore)) return { status: 'content-missing' };
    const result = pasteBranchSequenceState(chats, chatIndex, input.afterNodeId, clipboard, get().contentStore);
    get().applyBranchState(result.chats, result.contentStore);
    return { status: 'pasted', nodeIds: result.chats[chatIndex].branchTree!.activePath.slice(-clipboard.nodeIds.length) };
  },

  setBranchClipboard: (clipboard) => {
    set({ branchClipboard: clipboard });
  },
  });
};
