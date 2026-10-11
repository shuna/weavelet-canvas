import { invalidateAiTasks } from '@hooks/aiTaskLifetime';
import { v4 as uuidv4 } from 'uuid';
import { StoreSlice, StoreState } from './store';
import { BubbleSummary, ChatInterface, FolderCollection, GeneratingSession, MessageInterface, TextContentInterface } from '@type/chat';
import { notifyStorageError, setLocalStorageItem } from './storage/storageErrors';
import { addContent, retainContent, releaseContent } from '@utils/contentStore';
import { materializeActivePath } from '@utils/branchUtils';
import { generateDefaultChat } from '@constants/chat';
import { deepCloneSingleChat } from '@utils/chatShallowClone';
import { prepareChatForExport } from '@utils/chatExport';
import { finalizeStreamingSnapshotState } from '@utils/streamingBuffer';
import { isBubbleSummary, isSummaryEligible } from '@utils/bubbleSummary';
import { recordChatEdits } from './chat-edit-time';

export interface ChatSlice {
  lastContentEditedAt?: number;
  removeChats: (input: { chatIds: readonly string[] }) => { removedChatIds: string[]; missingChatIds: string[]; selectedChatId: string };
  createChat: (input: { folderId?: string }) => { status: 'created'; chatId: string } | { status: 'folder-missing' | 'not-ready' };
  duplicateChat: (input: { chatId: string; scope: 'all' | 'activePath' }) => { status: 'created'; chatId: string } | { status: 'chat-missing' };
  renameChat: (input: { chatId: string; title: string }) => 'updated' | 'unchanged' | 'chat-missing';
  createFolder: () => { folderId: string };
  editFolder: (input: { folderId: string; patch: { name?: string; color?: string | null; expanded?: boolean } }) => 'updated' | 'unchanged' | 'folder-missing';
  removeFolder: (input: { folderId: string }) => { status: 'removed' | 'folder-missing'; detachedChatIds: string[] };
  moveChatsToFolder: (input: { chatIds: string[]; folderId: string | null; expandDestination: boolean }) => { status: 'applied' | 'folder-missing' | 'invalid-input'; movedChatIds: string[]; missingChatIds: string[] };
  messages: MessageInterface[];
  chats?: ChatInterface[];
  collapsedNodeMaps: Record<string, Record<string, boolean>>;
  omittedNodeMaps: Record<string, Record<string, boolean>>;
  protectedNodeMaps: Record<string, Record<string, boolean>>;
  currentChatIndex: number;
  generatingSessions: Record<string, GeneratingSession>;
  error: string;
  lastSubmitMode: 'append' | 'midchat' | null;
  lastSubmitIndex: number | null;
  lastSubmitChatIndex: number | null;
  lastSubmitChatId: string | null;
  folders: FolderCollection;
  setMessages: (messages: MessageInterface[]) => void;
  setChats: (chats: ChatInterface[], options?: { preserveBranchHistory?: boolean }) => void;
  setCurrentChatIndex: (currentChatIndex: number) => void;
  setError: (error: string) => void;
  setLastSubmitContext: (
    mode: 'append' | 'midchat' | null,
    index: number | null,
    chatIndex: number | null,
    chatId?: string | null
  ) => void;
  setChatSystemPrompt: (input: { chatId: string; prompt: string }) => { status: 'updated' | 'unchanged' | 'chat-missing' };
  setFolders: (folders: FolderCollection) => void;
  addSession: (session: GeneratingSession) => void;
  removeSession: (sessionId: string) => void;
  updateSession: (sessionId: string, patch: Partial<GeneratingSession>) => void;
  removeSessionsForChat: (chatId: string) => void;
  setAllCollapsed: (input: { chatId: string; value: boolean }) => { status: 'updated' | 'unchanged' | 'missing' };
  setAllOmitted: (input: { chatId: string; value: boolean }) => { status: 'updated' | 'unchanged' | 'missing' };
  setNodeCollapsed: (input: { chatId: string; nodeId: string; value: boolean }) => { status: 'updated' | 'unchanged' | 'missing' };
  setNodeOmitted: (input: { chatId: string; nodeId: string; value: boolean }) => { status: 'updated' | 'unchanged' | 'missing' };
  setNodeProtected: (input: { chatId: string; nodeId: string; value: boolean }) => { status: 'updated' | 'unchanged' | 'missing' };
  toggleSummaryTarget: (chatIndex: number, messageIndex: number) => void;
  removeBubbleSummary: (chatId: string, summaryId: string) => void;
  saveBubbleSummary: (chatId: string, summary: BubbleSummary) => void;
  setSummaryForSubmit: (chatId: string, summaryId: string, use: boolean) => void;
}

type NodeMapField = 'collapsedNodes' | 'omittedNodes' | 'protectedNodes' | 'summaryTargets';

/** Produce a new chats array with updated node-map field for one chat. */
const updateChatNodeField = (
  chats: ChatInterface[],
  chatIndex: number,
  field: NodeMapField,
  value: Record<string, boolean>
): ChatInterface[] => {
  const updated = chats.slice();
  updated[chatIndex] = { ...updated[chatIndex], [field]: value };
  return updated;
};

const buildNodeMaps = (chats: ChatInterface[] | undefined, field: NodeMapField) => {
  const next: Record<string, Record<string, boolean>> = {};
  chats?.forEach((chat, index) => {
    const nodes = chat[field];
    if (nodes && Object.keys(nodes).length > 0) {
      next[String(index)] = { ...nodes };
    }
  });
  return next;
};

const hasSameChatOrder = (
  prevChats: ChatInterface[] | undefined,
  nextChats: ChatInterface[]
) => {
  if (!prevChats || prevChats.length !== nextChats.length) return false;
  return prevChats.every((chat, index) => chat.id === nextChats[index]?.id);
};

export const createChatSlice: StoreSlice<ChatSlice> = (setState, get) => {
  const set: typeof setState = (partial, replace) => setState(previous => {
    const patch = typeof partial === 'function' ? partial(previous) : partial;
    const now = Date.now();
    const edits = patch.chats && patch.chats !== previous.chats ? recordChatEdits(previous.chats, patch.chats, now) : undefined;
    const folderContents = (folders: FolderCollection) => Object.entries(folders).map(([id, folder]) => [id, folder.name, folder.order]);
    const foldersEdited = patch.folders && patch.folders !== previous.folders &&
      JSON.stringify(folderContents(patch.folders)) !== JSON.stringify(folderContents(previous.folders));
    return {
      ...patch,
      ...(edits ? { chats: edits.chats } : {}),
      ...(edits?.changed || foldersEdited ? { lastContentEditedAt: now } : {}),
    };
  }, replace);
  const setNodeMap = (input: { chatId: string; nodeId?: string; value: boolean }, field: NodeMapField, runtime: 'collapsedNodeMaps' | 'omittedNodeMaps' | 'protectedNodeMaps') => {
    const chats = get().chats;
    const index = chats?.findIndex(chat => chat.id === input.chatId) ?? -1;
    const chat = chats?.[index];
    if (!chat) return { status: 'missing' as const };
    if (input.nodeId !== undefined && !(chat.branchTree ? chat.branchTree.nodes[input.nodeId]
      : String(Number(input.nodeId)) === input.nodeId && Number(input.nodeId) >= 0 && chat.messages[Number(input.nodeId)])) return { status: 'missing' as const };
    const previous = chat[field] ?? {};
    const next = input.nodeId !== undefined ? { ...previous } : {};
    if (input.nodeId !== undefined) {
      if (!!previous[input.nodeId] === input.value) return { status: 'unchanged' as const };
      if (input.value) next[input.nodeId] = true;
      else delete next[input.nodeId];
    } else if (input.value) {
      for (const id of chat.branchTree?.activePath ?? chat.messages.map((_, index) => String(index))) next[id] = true;
    }
    if (Object.keys(previous).length === Object.keys(next).length && Object.keys(next).every(id => previous[id] === next[id])) return { status: 'unchanged' as const };
    set({ chats: updateChatNodeField(chats!, index, field, next), [runtime]: { ...get()[runtime], [String(index)]: next } });
    if (field === 'omittedNodes') invalidateAiTasks([input.chatId], input.nodeId ? [input.nodeId] : undefined);
    return { status: 'updated' as const };
  };
  const selectNewChat = (chat: ChatInterface, contentStore = get().contentStore) => {
    const state = get();
    state.captureCurrentNavigationEntry();
    const chats = [chat, ...(state.chats ?? [])];
    set({ chats, contentStore,
      collapsedNodeMaps: buildNodeMaps(chats, 'collapsedNodes'),
      omittedNodeMaps: buildNodeMaps(chats, 'omittedNodes'),
      protectedNodeMaps: buildNodeMaps(chats, 'protectedNodes'),
    });
    state.pushNavigationEntry({ chatId: chat.id, activePath: [...(chat.branchTree?.activePath ?? [])], viewContext: state.chatActiveView, source: 'chat-switch' });
    get().setCurrentChatIndex(0);
    return { status: 'created' as const, chatId: chat.id };
  };
  return {
    removeChats: ({ chatIds }) => {
      const ids = new Set(chatIds);
      const previous = get().chats ?? [];
      const removedChatIds = previous.filter(chat => ids.has(chat.id)).map(chat => chat.id);
      const missingChatIds = [...ids].filter(id => !removedChatIds.includes(id));
      if (!removedChatIds.length) return { removedChatIds, missingChatIds, selectedChatId: previous[get().currentChatIndex]?.id ?? '' };
      invalidateAiTasks(removedChatIds);
      const state = get();
      const contentStore = structuredClone(state.contentStore);
      const chats = (state.chats ?? []).filter(chat => {
        if (!ids.has(chat.id)) return true;
        for (const node of Object.values(chat.branchTree?.nodes ?? {})) releaseContent(contentStore, node.contentHash);
        return false;
      });
      if (!chats.length) chats.push(generateDefaultChat());
      const touches = (snapshot: StoreState['branchHistoryPast'][number]) => snapshot.chats.some(chat => ids.has(chat.id));
      set({ chats, contentStore,
        generatingSessions: Object.fromEntries(Object.entries(state.generatingSessions).filter(([, session]) => !ids.has(session.chatId))),
        branchHistoryPast: state.branchHistoryPast.filter(snapshot => !touches(snapshot)),
        branchHistoryFuture: state.branchHistoryFuture.filter(snapshot => !touches(snapshot)),
        collapsedNodeMaps: buildNodeMaps(chats, 'collapsedNodes'),
        omittedNodeMaps: buildNodeMaps(chats, 'omittedNodes'),
        protectedNodeMaps: buildNodeMaps(chats, 'protectedNodes'),
      });
      get().setCurrentChatIndex(0);
      return { removedChatIds, missingChatIds, selectedChatId: chats[0].id };
    },
    createChat: ({ folderId }) => {
      const { chats, folders } = get();
      if (!chats) return { status: 'not-ready' };
      if (folderId !== undefined && !folders[folderId]) return { status: 'folder-missing' };
      let number = 1;
      while (chats.some(chat => chat.title === `New Chat ${number}`)) number++;
      return selectNewChat(generateDefaultChat(`New Chat ${number}`, folderId));
    },
    duplicateChat: ({ chatId, scope }) => {
      const { chats, contentStore: current } = get();
      const source = chats?.find(chat => chat.id === chatId);
      if (!source) return { status: 'chat-missing' };
      let title = `Copy of ${source.title}`;
      let number = 0;
      while (chats!.some(chat => chat.title === title)) title = `Copy ${++number} of ${source.title}`;
      const snapshot = finalizeStreamingSnapshotState([source], current);
      const frozen = snapshot.chats![0];
      const copy = deepCloneSingleChat(scope === 'activePath'
        ? prepareChatForExport(frozen, snapshot.contentStore, { visibleBranchOnly: true }).chat : frozen);
      copy.title = title;
      const contentStore = { ...current };
      for (const node of Object.values(copy.branchTree?.nodes ?? {})) {
        const entry = contentStore[node.contentHash];
        contentStore[node.contentHash] = entry ? { ...entry } : { ...snapshot.contentStore[node.contentHash], refCount: 0 };
        retainContent(contentStore, node.contentHash);
      }
      return selectNewChat(copy, contentStore);
    },
    renameChat: ({ chatId, title }) => {
      const chats = get().chats;
      const chat = chats?.find(chat => chat.id === chatId);
      if (!chat) return 'chat-missing';
      if (chat.title === title) return 'unchanged';
      set({ chats: chats!.map(value => value === chat ? { ...value, title } : value) });
      return 'updated';
    },
    createFolder: () => {
      const folders = get().folders;
      let number = 1;
      while (Object.values(folders).some(folder => folder.name === `New Folder ${number}`)) number++;
      const folderId = uuidv4();
      const shifted = Object.fromEntries(Object.entries(folders).map(([id, folder]) => [id, { ...folder, order: folder.order + 1 }]));
      set({ folders: { [folderId]: { id: folderId, name: `New Folder ${number}`, expanded: false, order: 0 }, ...shifted } });
      return { folderId };
    },
    editFolder: ({ folderId, patch }) => {
      const folders = get().folders;
      const folder = folders[folderId];
      if (!folder) return 'folder-missing';
      const next = { ...folder, ...patch, color: patch.color === null ? undefined : patch.color ?? folder.color };
      if (next.name === folder.name && next.color === folder.color && next.expanded === folder.expanded) return 'unchanged';
      set({ folders: { ...folders, [folderId]: next } });
      return 'updated';
    },
    removeFolder: ({ folderId }) => {
      const { folders, chats } = get();
      if (!folders[folderId]) return { status: 'folder-missing', detachedChatIds: [] };
      const nextFolders = { ...folders };
      delete nextFolders[folderId];
      const detachedChatIds: string[] = [];
      const nextChats = chats?.map(chat => {
        if (chat.folder !== folderId) return chat;
        detachedChatIds.push(chat.id);
        return { ...chat, folder: undefined };
      });
      set({ folders: nextFolders, chats: nextChats });
      return { status: 'removed', detachedChatIds };
    },
    moveChatsToFolder: ({ chatIds, folderId, expandDestination }) => {
      const { chats, folders } = get();
      if (folderId === null && expandDestination) return { status: 'invalid-input', movedChatIds: [], missingChatIds: [] };
      if (folderId !== null && !folders[folderId]) return { status: 'folder-missing', movedChatIds: [], missingChatIds: [] };
      const remaining = new Set(chatIds);
      const movedChatIds: string[] = [];
      const nextChats = chats?.map(chat => {
        if (!remaining.delete(chat.id)) return chat;
        movedChatIds.push(chat.id);
        return chat.folder === (folderId ?? undefined) ? chat : { ...chat, folder: folderId ?? undefined };
      });
      set({ chats: nextChats, folders: folderId !== null && expandDestination
        ? { ...folders, [folderId]: { ...folders[folderId], expanded: true } } : folders });
      return { status: 'applied', movedChatIds, missingChatIds: [...remaining] };
    },
    messages: [],
    collapsedNodeMaps: {},
    omittedNodeMaps: {},
    protectedNodeMaps: {},
    currentChatIndex: -1,
    generatingSessions: {},
    error: '',
    lastSubmitMode: null,
    lastSubmitIndex: null,
    lastSubmitChatIndex: null,
    lastSubmitChatId: null,
    folders: {},
    setMessages: (messages: MessageInterface[]) => {
      set((prev: ChatSlice) => ({
        ...prev,
        messages: messages,
      }));
    },
    setChats: (chats: ChatInterface[], options) => {
      try {
        if (!options?.preserveBranchHistory && get().chats) {
          const previousById = new Map(get().chats!.map((chat) => [chat.id, chat]));
          const nextById = new Map(chats.map((chat) => [chat.id, chat]));
          const changedIds = new Set<string>();
          for (const chat of get().chats!) {
            const next = nextById.get(chat.id);
            if (!next || chat.messages !== next.messages || chat.branchTree !== next.branchTree) {
              changedIds.add(chat.id);
            }
          }
          for (const chat of chats) {
            if (!previousById.has(chat.id)) changedIds.add(chat.id);
          }
          get().invalidateBranchHistory([...changedIds]);
        }
        set((prev: ChatSlice) => {
          const sameOrder = hasSameChatOrder(prev.chats, chats);
          return {
            ...prev,
            chats: chats,
            collapsedNodeMaps: sameOrder
              ? prev.collapsedNodeMaps
              : buildNodeMaps(chats, 'collapsedNodes'),
            omittedNodeMaps: sameOrder
              ? prev.omittedNodeMaps
              : buildNodeMaps(chats, 'omittedNodes'),
            protectedNodeMaps: sameOrder
              ? prev.protectedNodeMaps
              : buildNodeMaps(chats, 'protectedNodes'),
          };
        });
      } catch (e: unknown) {
        notifyStorageError(e);
        throw e;
      }
    },
    setCurrentChatIndex: (currentChatIndex: number) => {
      if (get().currentChatIndex === currentChatIndex) return;
      set((prev: ChatSlice) => ({
        ...prev,
        currentChatIndex: currentChatIndex,
      }));
      // Persist separately to avoid triggering heavy main-store serialization
      setLocalStorageItem('currentChatIndex', String(currentChatIndex));
    },
    setLastSubmitContext: (
      mode: 'append' | 'midchat' | null,
      index: number | null,
      chatIndex: number | null,
      chatId?: string | null
    ) => {
      set((prev: ChatSlice) => ({
        ...prev,
        lastSubmitMode: mode,
        lastSubmitIndex: index,
        lastSubmitChatIndex: chatIndex,
        lastSubmitChatId: chatId ?? null,
      }));
    },
    setError: (error: string) => {
      set((prev: ChatSlice) => ({
        ...prev,
        error: error,
      }));
    },
    setChatSystemPrompt: ({ chatId, prompt: systemPrompt }) => {
      const chats = get().chats;
      const chatIndex = chats?.findIndex(chat => chat.id === chatId) ?? -1;
      if (!chats || chatIndex < 0) return { status: 'chat-missing' };
      const top = chats[chatIndex].branchTree?.activePath[0];
      const node = top ? chats[chatIndex].branchTree?.nodes[top] : undefined;
      const bubble = node?.role === 'system' ? materializeActivePath(chats[chatIndex].branchTree!, get().contentStore)[0]?.content : undefined;
      if ((chats[chatIndex].config.systemPrompt ?? '') === systemPrompt &&
        (!chats[chatIndex].branchTree || (!systemPrompt && node?.role !== 'system') ||
        JSON.stringify(bubble) === JSON.stringify([{ type: 'text', text: systemPrompt }]))) return { status: 'unchanged' };
      const contentStore = { ...(get() as any).contentStore };
      const updated = chats.slice();
      const chat = { ...updated[chatIndex] };
      chat.config = { ...chat.config, systemPrompt: systemPrompt || undefined };
      updated[chatIndex] = chat;

      // Sync config → bubble
      if (chat.branchTree) {
        const tree = {
          ...chat.branchTree,
          nodes: { ...chat.branchTree.nodes },
          activePath: chat.branchTree.activePath.slice(),
        };
        chat.branchTree = tree;
        const topNodeId = tree.activePath[0];
        const topNode = topNodeId ? tree.nodes[topNodeId] : undefined;

        if (systemPrompt) {
          const newContent = [{ type: 'text', text: systemPrompt } as TextContentInterface];
          if (topNode && topNode.role === 'system') {
            // Update existing top system node content
            tree.nodes[topNodeId] = {
              ...topNode,
              contentHash: addContent(contentStore, newContent),
            };
          } else {
            // Create new system node at top
            const newId = uuidv4();
            tree.nodes[newId] = {
              id: newId,
              parentId: null,
              role: 'system',
              contentHash: addContent(contentStore, newContent),
              createdAt: Date.now(),
            };
            // Relink existing top node
            if (topNodeId && tree.nodes[topNodeId]) {
              tree.nodes[topNodeId] = { ...tree.nodes[topNodeId], parentId: newId };
            }
            tree.activePath.unshift(newId);
            tree.rootId = newId;
          }
        } else {
          // Empty system prompt → remove top system node if present
          if (topNode && topNode.role === 'system') {
            const nextId = tree.activePath[1];
            if (nextId && tree.nodes[nextId]) {
              tree.nodes[nextId] = { ...tree.nodes[nextId], parentId: null };
            }
            tree.activePath.splice(0, 1);
            if (tree.activePath.length > 0) {
              tree.rootId = tree.activePath[0];
            }
          }
        }
        chat.messages = materializeActivePath(tree, contentStore);
      }

      get().invalidateBranchHistory([chat.id]);
      set((prev: ChatSlice) => ({ ...prev, chats: updated, contentStore } as any));
      invalidateAiTasks([chatId]);
      return { status: 'updated' };
    },
    setFolders: (folders: FolderCollection) => {
      set((prev: ChatSlice) => ({
        ...prev,
        folders: folders,
      }));
    },
    addSession: (session: GeneratingSession) => {
      set((prev: ChatSlice) => ({
        ...prev,
        generatingSessions: {
          ...prev.generatingSessions,
          [session.sessionId]: session,
        },
      }));
    },
    removeSession: (sessionId: string) => {
      set((prev: ChatSlice) => {
        const next = { ...prev.generatingSessions };
        delete next[sessionId];
        return { ...prev, generatingSessions: next };
      });
    },
    updateSession: (sessionId: string, patch: Partial<GeneratingSession>) => {
      set((prev: ChatSlice) => {
        const session = prev.generatingSessions[sessionId];
        if (!session) return prev;
        return {
          ...prev,
          generatingSessions: {
            ...prev.generatingSessions,
            [sessionId]: { ...session, ...patch },
          },
        };
      });
    },
    removeSessionsForChat: (chatId: string) => {
      set((prev: ChatSlice) => {
        const next: Record<string, GeneratingSession> = {};
        for (const [k, v] of Object.entries(prev.generatingSessions)) {
          if (v.chatId !== chatId) next[k] = v;
        }
        return { ...prev, generatingSessions: next };
      });
    },
    setAllCollapsed: (input) => setNodeMap(input, 'collapsedNodes', 'collapsedNodeMaps'),
    setAllOmitted: (input) => setNodeMap(input, 'omittedNodes', 'omittedNodeMaps'),
    setNodeCollapsed: (input) => setNodeMap(input, 'collapsedNodes', 'collapsedNodeMaps'),
    setNodeOmitted: (input) => setNodeMap(input, 'omittedNodes', 'omittedNodeMaps'),
    setNodeProtected: (input) => setNodeMap(input, 'protectedNodes', 'protectedNodeMaps'),
    toggleSummaryTarget: (chatIndex: number, messageIndex: number) => {
      const chats = get().chats;
      const chat = chats?.[chatIndex];
      const nodeId = chat?.branchTree?.activePath[messageIndex] ?? String(messageIndex);
      if (!chats || !chat || !isSummaryEligible(chat.messages[messageIndex])) return;
      const summaryTargets = { ...(chat.summaryTargets ?? {}) };
      if (summaryTargets[nodeId]) delete summaryTargets[nodeId]; else summaryTargets[nodeId] = true;
      set({ chats: updateChatNodeField(chats, chatIndex, 'summaryTargets', summaryTargets) });
    },
    removeBubbleSummary: (chatId, summaryId) => {
      const chats = get().chats;
      if (chats) set({ chats: chats.map(chat => chat.id === chatId ? { ...chat, summaries: chat.summaries?.filter(summary => summary.id !== summaryId) } : chat) });
    },
    saveBubbleSummary: (chatId: string, summary: BubbleSummary) => {
      const chats = get().chats;
      if (!chats || !isBubbleSummary(summary)) return;
      set({ chats: chats.map(chat => chat.id !== chatId ? chat : {
        ...chat,
        summaries: [...(Array.isArray(chat.summaries) ? chat.summaries.filter(item => item.id !== summary.id) : []), summary],
      }) });
    },
    setSummaryForSubmit: (chatId: string, summaryId: string, use: boolean) => {
      const chats = get().chats;
      if (!chats) return;
      set({ chats: chats.map(chat => {
        if (chat.id !== chatId || !Array.isArray(chat.summaries)) return chat;
        const chosen = chat.summaries.find(summary => summary.id === summaryId);
        if (!chosen) return chat;
        const overlaps = (left: BubbleSummary, right: BubbleSummary) => left.sources.some(source => right.sources.some(other => source.nodeId === other.nodeId));
        return { ...chat, summaries: chat.summaries.map(summary => ({ ...summary, useForSubmit: summary.id === summaryId ? use : overlaps(summary, chosen) ? false : summary.useForSubmit })) };
      }) });
    },
  };
};
