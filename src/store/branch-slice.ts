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
  deleteBranchState,
  pruneHiddenNodesState,
  ensureBranchTreeState,
  insertMessageAtIndexState,
  moveMessageState,
  pasteBranchSequenceState,
  removeMessageAtIndexState,
  removeBranchSequenceState,
  setBranchNodeFieldState,
  replaceMessageAndPruneFollowingState,
  switchActivePathState,
  switchBranchAtNodeState,
  truncateActivePathState,
  updateNodeRoleState,
  upsertMessageAtIndexState,
  upsertWithAutoBranchState,
  updateLastNodeContentState,
} from './branch-domain';
import { cloneChatAt } from './branch-domain';

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

interface BranchChatSnapshot {
  id: string;
  messages: ChatInterface['messages'];
  branchTree: ChatInterface['branchTree'];
  expectedActivePath?: string[];
  systemPrompt?: { value: string | undefined };
}

interface BranchSnapshot {
  chats: BranchChatSnapshot[];
  contentStore: ContentStoreData;
}

const HISTORY_LIMIT = 50;

const changedBranchChatIds = (
  previous: ChatInterface[],
  next: ChatInterface[]
) => {
  const nextById = new Map(next.map((chat) => [chat.id, chat]));
  const previousById = new Map(previous.map((chat) => [chat.id, chat]));
  const ids = new Set<string>();
  for (const chat of previous) {
    const updated = nextById.get(chat.id);
    if (!updated || chat.messages !== updated.messages || chat.branchTree !== updated.branchTree) {
      ids.add(chat.id);
    }
  }
  for (const chat of next) {
    if (!previousById.has(chat.id)) ids.add(chat.id);
  }
  return [...ids];
};

const snapshotContentStore = (
  chats: BranchChatSnapshot[],
  contentStore: ContentStoreData
) => {
  const snapshot: ContentStoreData = {};
  const add = (hash: string) => {
    const entry = contentStore[hash];
    if (snapshot[hash] || !entry) return;
    snapshot[hash] = structuredClone(entry);
    if (entry.delta) add(entry.delta.baseHash);
  };
  for (const chat of chats) {
    Object.values(chat.branchTree?.nodes ?? {}).forEach((node) => add(node.contentHash));
  }
  return snapshot;
};

const createBranchSnapshot = (
  chats: ChatInterface[],
  contentStore: ContentStoreData,
  chatIds: string[],
  expectedChats: ChatInterface[] = chats
): BranchSnapshot => {
  const ids = new Set(chatIds);
  const expectedById = new Map(expectedChats.map((chat) => [chat.id, chat]));
  const snapshotChats = chats
    .filter((chat) => ids.has(chat.id))
    .map((chat) => ({
      id: chat.id,
      messages: structuredClone(chat.messages),
      branchTree: structuredClone(chat.branchTree),
      expectedActivePath: expectedById.get(chat.id)?.branchTree?.activePath.slice(),
      ...(chat.config.systemPrompt !== expectedById.get(chat.id)?.config.systemPrompt
        ? { systemPrompt: { value: chat.config.systemPrompt } }
        : {}),
    }));
  return {
    chats: snapshotChats,
    contentStore: snapshotContentStore(snapshotChats, contentStore),
  };
};

const isUsableActivePath = (
  tree: NonNullable<ChatInterface['branchTree']>,
  path: string[]
) => path.length > 0 && path.every((id, index) => {
  const node = tree.nodes[id];
  return !!node && (index === 0 ? node.parentId === null : node.parentId === path[index - 1]);
});

const pathsEqual = (first: string[], second: string[]) =>
  first.length === second.length && first.every((id, index) => id === second[index]);

const restoreBranchSnapshot = (
  chats: ChatInterface[],
  contentStore: ContentStoreData,
  snapshot: BranchSnapshot
) => {
  const snapshots = new Map(snapshot.chats.map((chat) => [chat.id, chat]));
  const restored = chats.map((chat) => {
    const saved = snapshots.get(chat.id);
    if (!saved) return chat;
    const config = saved.systemPrompt
      ? { ...chat.config, systemPrompt: saved.systemPrompt.value }
      : chat.config;
    if (!saved.branchTree) return { ...chat, config, messages: structuredClone(saved.messages), branchTree: undefined };
    const branchTree = structuredClone(saved.branchTree);
    const currentPath = chat.branchTree?.activePath;
    if (currentPath && saved.expectedActivePath &&
      !pathsEqual(currentPath, saved.expectedActivePath) &&
      isUsableActivePath(branchTree, currentPath)) {
      branchTree.activePath = currentPath.slice();
    }
    return { ...chat, config, branchTree, messages: materializeActivePath(branchTree, contentStore) };
  });
  return restored;
};

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

const resolveNodeTarget = (chats: ChatInterface[] | undefined, input: NodeTarget, activeOnly = false) => {
  const chatIndex = chats?.findIndex((chat) => chat.id === input.chatId) ?? -1;
  const chat = chats?.[chatIndex];
  if (!chat) return { status: 'chat-missing' as const };
  const index = chat.branchTree
    ? chat.branchTree.activePath.indexOf(input.nodeId)
    : Number(input.nodeId);
  const exists = chat.branchTree ? !!chat.branchTree.nodes[input.nodeId]
    : Number.isInteger(index) && index >= 0 && String(index) === input.nodeId && !!chat.messages[index];
  if (!exists) return { status: 'node-missing' as const };
  if (activeOnly && index < 0) return { status: 'invalid-target' as const };
  return { status: 'valid' as const, chatIndex, messageIndex: index, chat };
};

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
  replaceNodeAndPrune: (input: NodeEdit & { removeCount: number }) => { status: 'updated' | 'missing' | 'invalid-input'; removedNodeIds: string[]; pruneBlockedBy: string[] };
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
  deleteBranch: (chatIndex: number, nodeId: string) => void;
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
    const target = resolveNodeTarget(get().chats, input);
    if (target.status !== 'valid') return target;
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
    const nodeId = target.chat.branchTree ? input.nodeId : ensured.chats[target.chatIndex].branchTree!.activePath[target.messageIndex];
    if (ensured.chats[target.chatIndex].branchTree!.nodes[nodeId][field] === value) return { status: 'unchanged' };
    const chats = setBranchNodeFieldState(ensured.chats, target.chatIndex, nodeId, field, value);
    get().applyBranchState(chats, ensured.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  };
  return ({
  contentStore: {},
  setContentStore: (contentStore) => {
    set({ contentStore });
  },
  applyBranchState: (chats, contentStore, options) => {
    const prevChats = get().chats;
    // Legacy tree creation has no undo step; record the edit against that prepared tree.
    const historyChats = options?.historyBase?.chats ?? prevChats;
    const historyStore = options?.historyBase?.contentStore ?? get().contentStore;
    const changedIds = historyChats ? changedBranchChatIds(historyChats, chats) : [];
    const history = options?.recordHistory !== false && prevChats && changedIds.length > 0
      ? {
          branchHistoryPast: [...get().branchHistoryPast, createBranchSnapshot(
            historyChats!, historyStore, changedIds, chats
          )].slice(-HISTORY_LIMIT),
          branchHistoryFuture: [],
        }
      : {};
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
    set({ chats, contentStore, ...history, ...clipboard, ...attributes });
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
    if (chatIds.length === 0) return;
    const ids = new Set(chatIds);
    const touches = (snapshot: BranchSnapshot) => snapshot.chats.some((chat) => ids.has(chat.id));
    set({
      branchHistoryPast: get().branchHistoryPast.filter((snapshot) => !touches(snapshot)),
      branchHistoryFuture: get().branchHistoryFuture.filter((snapshot) => !touches(snapshot)),
    });
  },
  branchHistoryPast: [],
  branchHistoryFuture: [],
  undoBranch: () => {
    const past = get().branchHistoryPast;
    if (past.length === 0) return;
    const snapshot = past[past.length - 1];
    const currentChats = get().chats;
    if (!currentChats || snapshot.chats.some((chat) =>
      !currentChats.some((current) => current.id === chat.id) ||
      Object.values(get().generatingSessions).some((session) => session.chatId === chat.id)
    )) return;
    const currentContentStore = get().contentStore;
    const current = createBranchSnapshot(
      currentChats, currentContentStore, snapshot.chats.map((chat) => chat.id),
      restoreBranchSnapshot(currentChats, currentContentStore, snapshot)
    );
    const contentStore = { ...snapshot.contentStore, ...currentContentStore };
    set({
      branchHistoryPast: past.slice(0, -1),
      branchHistoryFuture: [...get().branchHistoryFuture, current],
    });
    get().setChats(restoreBranchSnapshot(currentChats, contentStore, snapshot), { preserveBranchHistory: true });
    set({ contentStore });
    invalidateAiTasks(snapshot.chats.map(chat => chat.id));
  },
  redoBranch: () => {
    const future = get().branchHistoryFuture;
    if (future.length === 0) return;
    const snapshot = future[future.length - 1];
    const currentChats = get().chats;
    if (!currentChats || snapshot.chats.some((chat) =>
      !currentChats.some((current) => current.id === chat.id) ||
      Object.values(get().generatingSessions).some((session) => session.chatId === chat.id)
    )) return;
    const currentContentStore = get().contentStore;
    const current = createBranchSnapshot(
      currentChats, currentContentStore, snapshot.chats.map((chat) => chat.id),
      restoreBranchSnapshot(currentChats, currentContentStore, snapshot)
    );
    const contentStore = { ...snapshot.contentStore, ...currentContentStore };
    set({
      branchHistoryFuture: future.slice(0, -1),
      branchHistoryPast: [...get().branchHistoryPast, current],
    });
    get().setChats(restoreBranchSnapshot(currentChats, contentStore, snapshot), { preserveBranchHistory: true });
    set({ contentStore });
    invalidateAiTasks(snapshot.chats.map(chat => chat.id));
  },
  canUndoBranch: () => get().branchHistoryPast.length > 0 && !Object.values(get().generatingSessions).some(
    (session) => get().branchHistoryPast.at(-1)?.chats.some((chat) => chat.id === session.chatId)
  ),
  canRedoBranch: () => get().branchHistoryFuture.length > 0 && !Object.values(get().generatingSessions).some(
    (session) => get().branchHistoryFuture.at(-1)?.chats.some((chat) => chat.id === session.chatId)
  ),
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
    const chats = get().chats;
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
    const target = resolveNodeTarget(get().chats, input);
    if (target.status !== 'valid') return target;
    const currentRole = target.chat.branchTree?.nodes[input.nodeId]?.role ?? target.chat.messages[target.messageIndex]?.role;
    if (currentRole === input.role) return { status: 'unchanged' };
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
    const nodeId = target.chat.branchTree ? input.nodeId : ensured.chats[target.chatIndex].branchTree!.activePath[target.messageIndex];
    const chats = updateNodeRoleState(ensured.chats, target.chatIndex, nodeId, input.role, ensured.contentStore);
    get().applyBranchState(chats, ensured.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  },
  setNodeStar: (input) => setNodeField(input, 'starred', input.value || undefined),
  setNodePin: (input) => setNodeField(input, 'pinned', input.value || undefined),
  setNodeLabel: (input) => setNodeField(input, 'label', input.value || undefined),
  saveNode: (input) => {
    const target = resolveNodeTarget(get().chats, input, true);
    if (target.status !== 'valid') return target;
    if ((target.chat.protectedNodes ?? {})[input.nodeId]) return { status: 'protected' };
    if (Object.values(get().generatingSessions).some(session => session.chatId === input.chatId && session.targetNodeId === input.nodeId)) return { status: 'busy' };
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
    const result = upsertWithAutoBranchState(ensured.chats, target.chatIndex, target.messageIndex, input, ensured.contentStore);
    if (result.noOp) return { status: 'unchanged' };
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  },
  appendNode: (input) => {
    const chatIndex = get().chats?.findIndex(chat => chat.id === input.chatId) ?? -1;
    if (chatIndex < 0) return { status: 'chat-missing' };
    const ensured = ensureBranchTreeState(get().chats!, chatIndex, get().contentStore);
    const result = appendNodeToActivePathState(ensured.chats, chatIndex, input.role, input.content, ensured.contentStore);
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated', nodeId: result.newId };
  },
  insertNode: (input) => {
    const chatIndex = get().chats?.findIndex(chat => chat.id === input.chatId) ?? -1;
    if (chatIndex < 0) return { status: 'chat-missing' };
    const target = input.beforeNodeId === null ? null : resolveNodeTarget(get().chats, { chatId: input.chatId, nodeId: input.beforeNodeId }, true);
    if (target && target.status !== 'valid') return target;
    const index = target?.messageIndex ?? get().chats![chatIndex].messages.length;
    const ensured = ensureBranchTreeState(get().chats!, chatIndex, get().contentStore);
    const result = insertMessageAtIndexState(ensured.chats, chatIndex, index, input, ensured.contentStore);
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated', nodeId: result.newId };
  },
  removeNode: (input) => {
    const target = resolveNodeTarget(get().chats, input, true);
    if (target.status !== 'valid') return target;
    if ((target.chat.protectedNodes ?? {})[input.nodeId]) return { status: 'protected' };
    const preserveNode = Object.values(get().generatingSessions).some(session => session.chatId === input.chatId && session.targetNodeId === input.nodeId);
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
    const result = removeMessageAtIndexState(ensured.chats, target.chatIndex, target.messageIndex, ensured.contentStore, { preserveNode });
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  },
  moveNode: (input) => {
    const target = resolveNodeTarget(get().chats, input, true);
    if (target.status !== 'valid') return target;
    if (input.direction === 'up' ? target.messageIndex === 0 : target.messageIndex === target.chat.messages.length - 1) return { status: 'unchanged' };
    const topRole = target.chat.messages[0]?.role;
    if (topRole === 'system' && (target.messageIndex === 0 || (input.direction === 'up' && target.messageIndex === 1))) return { status: 'unchanged' };
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
    const result = moveMessageState(ensured.chats, target.chatIndex, target.messageIndex, input.direction, ensured.contentStore);
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated' };
  },
  replaceNodeAndPrune: (input) => {
    if (!Number.isInteger(input.removeCount) || input.removeCount < 0) return { status: 'invalid-input', removedNodeIds: [], pruneBlockedBy: [] };
    const target = resolveNodeTarget(get().chats, input, true);
    if (target.status !== 'valid') return { status: 'missing', removedNodeIds: [], pruneBlockedBy: [] };
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
    const prepared = ensured.chats[target.chatIndex];
    const following = prepared.branchTree!.activePath.slice(target.messageIndex + 1, target.messageIndex + 1 + input.removeCount);
    const pruneBlockedBy = following.filter(id => prepared.protectedNodes?.[id]);
    const result = replaceMessageAndPruneFollowingState(ensured.chats, target.chatIndex, target.messageIndex, input, ensured.contentStore, pruneBlockedBy.length ? 0 : input.removeCount);
    get().applyBranchState(result.chats, result.contentStore, { historyBase: ensured });
    return { status: 'updated', removedNodeIds: pruneBlockedBy.length ? [] : following, pruneBlockedBy };
  },

  ensureBranchTree: (chatIndex) => {
    const chats = get().chats;
    if (!chats || chats[chatIndex]?.branchTree) return;
    const { chats: updatedChats, contentStore } = ensureBranchTreeState(
      chats,
      chatIndex,
      get().contentStore
    );
    get().applyBranchState(updatedChats, contentStore, { recordHistory: false });
  },

  createBranch: (input) => {
    const target = resolveNodeTarget(get().chats, { chatId: input.chatId, nodeId: input.fromNodeId });
    if (target.status !== 'valid') return { status: target.status === 'chat-missing' ? 'chat-missing' : 'node-missing' };
    const ensured = ensureBranchTreeState(get().chats!, target.chatIndex, get().contentStore);
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
    const { chats, contentStore } = deleteBranchState(
      get().chats!,
      chatIndex,
      nodeId,
      get().contentStore
    );
    get().applyBranchState(chats, contentStore);
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
      get().chats!,
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
      get().chats!,
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
      get().chats!,
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
