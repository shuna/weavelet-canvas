import { StoreSlice } from './store';
import {
  BranchClipboard,
  ContentInterface,
  Role,
} from '@type/chat';
import { ContentStoreData } from '@utils/contentStore';
import {
  appendNodeToActivePathState,
  copyBranchSequenceState,
  createBranchState,
  deleteBranchState,
  ensureBranchTreeState,
  pasteBranchSequenceState,
  renameBranchNodeState,
  switchActivePathState,
  switchBranchAtNodeState,
  truncateActivePathState,
  updateLastNodeContentState,
} from './branch-domain';

export interface BranchSlice {
  contentStore: ContentStoreData;
  branchClipboard: BranchClipboard | null;
  branchEditorFocusNodeId: string | null;
  setBranchEditorFocusNodeId: (nodeId: string | null) => void;
  chatActiveView: 'chat' | 'branch-editor';
  setChatActiveView: (view: 'chat' | 'branch-editor') => void;

  // Multi-view state
  isMultiView: boolean;
  setIsMultiView: (enabled: boolean) => void;
  multiViewChatIndices: number[];
  setMultiViewChatIndices: (indices: number[]) => void;
  multiViewPrimaryChatIndex: number | null;
  setMultiViewPrimaryChatIndex: (index: number | null) => void;
  moveBranchSequence: (
    sourceChatIndex: number,
    fromNodeId: string,
    toNodeId: string,
    targetChatIndex: number,
    afterNodeId: string
  ) => void;
  activateFolderOverview: (folderId: string) => void;

  ensureBranchTree: (chatIndex: number) => void;
  createBranch: (
    chatIndex: number,
    fromNodeId: string,
    newContent?: ContentInterface[]
  ) => string;
  switchBranchAtNode: (chatIndex: number, nodeId: string) => void;
  switchActivePath: (chatIndex: number, newPath: string[]) => void;
  deleteBranch: (chatIndex: number, nodeId: string) => void;
  renameBranchNode: (
    chatIndex: number,
    nodeId: string,
    label: string
  ) => void;

  appendNodeToActivePath: (
    chatIndex: number,
    role: Role,
    content: ContentInterface[]
  ) => string;
  updateLastNodeContent: (
    chatIndex: number,
    content: ContentInterface[]
  ) => void;
  truncateActivePathAt: (chatIndex: number, nodeId: string) => void;

  copyBranchSequence: (
    chatIndex: number,
    fromNodeId: string,
    toNodeId: string
  ) => void;
  pasteBranchSequence: (
    targetChatIndex: number,
    afterNodeId: string
  ) => void;
  setBranchClipboard: (clipboard: BranchClipboard | null) => void;
}

export const createBranchSlice: StoreSlice<BranchSlice> = (set, get) => ({
  contentStore: {},
  branchClipboard: null,
  branchEditorFocusNodeId: null,
  setBranchEditorFocusNodeId: (nodeId) => {
    if (get().branchEditorFocusNodeId === nodeId) return;
    set({ branchEditorFocusNodeId: nodeId });
  },
  chatActiveView: 'chat' as 'chat' | 'branch-editor',
  setChatActiveView: (view) => {
    if (get().chatActiveView === view) return;
    set({ chatActiveView: view });
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
  moveBranchSequence: (sourceChatIndex, fromNodeId, toNodeId, targetChatIndex, afterNodeId) => {
    get().copyBranchSequence(sourceChatIndex, fromNodeId, toNodeId);
    get().pasteBranchSequence(targetChatIndex, afterNodeId);
    get().deleteBranch(sourceChatIndex, fromNodeId);
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

  ensureBranchTree: (chatIndex) => {
    const chats = get().chats;
    if (!chats || chats[chatIndex]?.branchTree) return;
    const { chats: updatedChats, contentStore } = ensureBranchTreeState(
      chats,
      chatIndex,
      get().contentStore
    );
    get().setChats(updatedChats);
    set({ contentStore });
  },

  createBranch: (chatIndex, fromNodeId, newContent) => {
    const { chats, contentStore, newId } = createBranchState(
      get().chats!,
      chatIndex,
      fromNodeId,
      newContent,
      get().contentStore
    );
    get().setChats(chats);
    set({ contentStore });
    return newId;
  },

  switchBranchAtNode: (chatIndex, nodeId) => {
    get().setChats(
      switchBranchAtNodeState(get().chats!, chatIndex, nodeId, get().contentStore)
    );
  },

  switchActivePath: (chatIndex, newPath) => {
    get().setChats(
      switchActivePathState(get().chats!, chatIndex, newPath, get().contentStore)
    );
  },

  deleteBranch: (chatIndex, nodeId) => {
    const { chats, contentStore } = deleteBranchState(
      get().chats!,
      chatIndex,
      nodeId,
      get().contentStore
    );
    get().setChats(chats);
    set({ contentStore });
  },

  renameBranchNode: (chatIndex, nodeId, label) => {
    get().setChats(renameBranchNodeState(get().chats!, chatIndex, nodeId, label));
  },

  appendNodeToActivePath: (chatIndex, role, content) => {
    const { chats, contentStore, newId } = appendNodeToActivePathState(
      get().chats!,
      chatIndex,
      role,
      content,
      get().contentStore
    );
    get().setChats(chats);
    set({ contentStore });
    return newId;
  },

  updateLastNodeContent: (chatIndex, content) => {
    const { chats, contentStore } = updateLastNodeContentState(
      get().chats!,
      chatIndex,
      content,
      get().contentStore
    );
    get().setChats(chats);
    set({ contentStore });
  },

  truncateActivePathAt: (chatIndex, nodeId) => {
    get().setChats(
      truncateActivePathState(get().chats!, chatIndex, nodeId, get().contentStore)
    );
  },

  copyBranchSequence: (chatIndex, fromNodeId, toNodeId) => {
    const chats = get().chats;
    if (!chats) return;
    const clipboard = copyBranchSequenceState(chats, chatIndex, fromNodeId, toNodeId);
    if (!clipboard) return;
    set({
      branchClipboard: clipboard,
    });
  },

  pasteBranchSequence: (targetChatIndex, afterNodeId) => {
    const clipboard = get().branchClipboard;
    if (!clipboard) return;
    const { chats, contentStore } = pasteBranchSequenceState(
      get().chats!,
      targetChatIndex,
      afterNodeId,
      clipboard,
      get().contentStore
    );
    get().setChats(chats);
    set({ contentStore });
  },

  setBranchClipboard: (clipboard) => {
    set({ branchClipboard: clipboard });
  },
});
