import { setChatNodeMapState, updateChatNodeField, type NodeMapField } from '@utils/nodeOptions';
import { applyFolderOperation } from '@utils/chatFolders';
import { addLibraryChat, clearLibraryChats, deleteLibraryChats, duplicateLibraryChat, renameLibraryChat } from '@utils/chatLibrary';
import { invalidateAiTasks } from '@hooks/aiTaskLifetime';
import { v4 as uuidv4 } from 'uuid';
import { StoreSlice, StoreState } from './store';
import { BubbleSummary, ChatInterface, FolderCollection, GeneratingSession, MessageInterface, TextContentInterface } from '@type/chat';
import { notifyStorageError, setLocalStorageItem } from './storage/storageErrors';
import { addContent, type ContentStoreData } from '@utils/contentStore';
import { materializeActivePath } from '@utils/branchUtils';
import { generateDefaultChat } from '@constants/chat';
import { isBubbleSummary, isSummaryEligible } from '@utils/bubbleSummary';
import { removeBubbleSummary as removeBubbleSummaryPure, saveBubbleSummary as saveBubbleSummaryPure,
  setSummaryForSubmit as setSummaryForSubmitPure, toggleSummaryTarget } from '@utils/bubbleSummaryOperations';
import { recordChatEdits, hasFolderContentEdits } from './chat-edit-time';

export interface ChatSlice {
  lastContentEditedAt?: number;
  clearConversations: () => void;
  removeChats: (input: { chatIds: readonly string[] }) => { removedChatIds: string[]; missingChatIds: string[]; selectedChatId: string };
  createChat: (input: { folderId?: string }) => { status: 'created'; chatId: string } | { status: 'folder-missing' | 'not-ready' };
  duplicateChat: (input: { chatId: string; scope: 'all' | 'activePath' }) => { status: 'created'; chatId: string } | { status: 'chat-missing' };
  renameChat: (input: { chatId: string; title: string }) => 'updated' | 'unchanged' | 'chat-missing';
  createFolder: () => { folderId: string };
  editFolder: (input: { folderId: string; patch: { name?: string; color?: string | null; expanded?: boolean; parentId?: string | null } }) => 'updated' | 'unchanged' | 'folder-missing' | 'invalid-input';
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
  setChats: (chats: ChatInterface[], options?: { preserveBranchHistory?: boolean; contentStore?: ContentStoreData }) => void;
  setCurrentChatIndex: (currentChatIndex: number) => void;
  setError: (error: string) => void;
  setLastSubmitContext: (
    mode: 'append' | 'midchat' | null,
    index: number | null,
    chatIndex: number | null,
    chatId?: string | null
  ) => void;
  setChatSystemPrompt: (input: { chatId: string; prompt: string }) => { status: 'updated' | 'unchanged' | 'chat-missing' };
  setFolders: (folders: FolderCollection, options?: { chats?: ChatInterface[] }) => void;
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
    const foldersEdited = patch.folders && patch.folders !== previous.folders &&
      hasFolderContentEdits(previous.folders, patch.folders);
    return {
      ...patch,
      ...(edits ? { chats: edits.chats } : {}),
      ...(edits?.changed || foldersEdited ? { lastContentEditedAt: now } : {}),
    };
  }, replace);
  const setNodeMap = (input: { chatId: string; nodeId?: string; value: boolean }, field: NodeMapField, runtime: 'collapsedNodeMaps' | 'omittedNodeMaps' | 'protectedNodeMaps') => {
    const result = setChatNodeMapState(get().chats, input, field);
    if (result.status !== 'updated') return result;
    set({ chats: result.chats, [runtime]: { ...get()[runtime], [String(result.chatIndex)]: result.map } });
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
  const removeChats = (chatIds: readonly string[], clear = false) => {
    const ids = new Set(chatIds);
    const previous = get().chats ?? [];
    const removedChatIds = previous.filter(chat => ids.has(chat.id)).map(chat => chat.id);
    const missingChatIds = [...ids].filter(id => !removedChatIds.includes(id));
    if (!removedChatIds.length && !clear) return { removedChatIds, missingChatIds, selectedChatId: previous[get().currentChatIndex]?.id ?? '' };
    const state = get();
    const selected = previous.flatMap((chat, index) => ids.has(chat.id) ? [index] : []);
    const cleared = clear ? clearLibraryChats(previous, state.contentStore, () => generateDefaultChat()) : undefined;
    const { chats, contentStore } = cleared ?? deleteLibraryChats(previous, selected, state.contentStore, () => generateDefaultChat());
    invalidateAiTasks(removedChatIds);
    const touches = (snapshot: StoreState['branchHistoryPast'][number]) => snapshot.chats.some(chat => ids.has(chat.id));
    set({ chats, contentStore, ...(cleared ? { folders: cleared.folders } : {}),
      generatingSessions: Object.fromEntries(Object.entries(state.generatingSessions).filter(([, session]) => !ids.has(session.chatId))),
      branchHistoryPast: state.branchHistoryPast.filter(snapshot => !touches(snapshot)),
      branchHistoryFuture: state.branchHistoryFuture.filter(snapshot => !touches(snapshot)),
      collapsedNodeMaps: buildNodeMaps(chats, 'collapsedNodes'),
      omittedNodeMaps: buildNodeMaps(chats, 'omittedNodes'),
      protectedNodeMaps: buildNodeMaps(chats, 'protectedNodes'),
    });
    get().setCurrentChatIndex(0);
    return { removedChatIds, missingChatIds, selectedChatId: chats[0].id };
  };
  return {
    removeChats: ({ chatIds }) => removeChats(chatIds),
    clearConversations: () => { removeChats((get().chats ?? []).map(chat => chat.id), true); },
    createChat: ({ folderId }) => {
      const { chats, folders } = get();
      if (!chats) return { status: 'not-ready' };
      if (folderId !== undefined && !folders[folderId]) return { status: 'folder-missing' };
      const added = addLibraryChat(chats, title => generateDefaultChat(title, folderId));
      return selectNewChat(added[0]);
    },
    duplicateChat: ({ chatId, scope }) => {
      const { chats, contentStore } = get();
      const index = chats?.findIndex(chat => chat.id === chatId) ?? -1;
      if (index < 0) return { status: 'chat-missing' };
      const result = duplicateLibraryChat(chats!, index, contentStore, undefined, scope);
      return selectNewChat(result.chats[0], result.contentStore);
    },
    renameChat: ({ chatId, title }) => {
      const chats = get().chats;
      const chat = chats?.find(chat => chat.id === chatId);
      if (!chat) return 'chat-missing';
      if (chat.title === title) return 'unchanged';
      set({ chats: renameLibraryChat(chats!, chats!.indexOf(chat), title) });
      return 'updated';
    },
    createFolder: () => {
      const folderId = uuidv4(), state = get();
      state.setFolders(applyFolderOperation(state, { type: 'create', id: folderId }).folders);
      return { folderId };
    },
    editFolder: ({ folderId, patch }) => {
      const state = get(), folder = state.folders[folderId];
      if (!Object.hasOwn(state.folders, folderId)) return 'folder-missing';
      let updated;
      try { updated = applyFolderOperation(state, { type: 'edit', id: folderId, patch }); }
      catch { return 'invalid-input'; }
      const next = updated.folders[folderId];
      if (next.name === folder.name && next.color === folder.color && next.expanded === folder.expanded && next.parentId === folder.parentId) return 'unchanged';
      state.setFolders(updated.folders);
      return 'updated';
    },
    removeFolder: ({ folderId }) => {
      const state = get();
      if (!Object.hasOwn(state.folders, folderId)) return { status: 'folder-missing', detachedChatIds: [] };
      const detachedChatIds = (state.chats ?? []).filter(chat => chat.folder === folderId).map(chat => chat.id);
      const next = applyFolderOperation(state, { type: 'remove', id: folderId });
      state.setFolders(next.folders, { chats: next.chats });
      return { status: 'removed', detachedChatIds };
    },
    moveChatsToFolder: ({ chatIds, folderId, expandDestination }) => {
      const state = get();
      if (folderId === null && expandDestination) return { status: 'invalid-input', movedChatIds: [], missingChatIds: [] };
      if (folderId !== null && !Object.hasOwn(state.folders, folderId)) return { status: 'folder-missing', movedChatIds: [], missingChatIds: [] };
      const remaining = new Set(chatIds);
      const movedChatIds = (state.chats ?? []).flatMap(chat => remaining.delete(chat.id) ? [chat.id] : []);
      const next = applyFolderOperation(state, { type: 'move', chatIds: movedChatIds, folderId: folderId ?? undefined, expandDestination });
      state.setFolders(next.folders, { chats: next.chats });
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
            ...(options?.contentStore === undefined ? {} : { contentStore: options.contentStore }),
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
    setFolders: (folders: FolderCollection, options) => {
      const previous = get();
      try {
        set((prev: ChatSlice) => ({ ...prev, folders, ...(options?.chats === undefined ? {} : { chats: options.chats }) }));
      } catch (error) {
        // Zustand publishes before synchronous persist. Restore the previous live state on write failure.
        try { setState(previous, true); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Folder save and rollback save failed.'); }
        throw error;
      }
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
      const updated = toggleSummaryTarget(chat, nodeId, messageIndex);
      set({ chats: updateChatNodeField(chats, chatIndex, 'summaryTargets', updated.summaryTargets ?? {}) });
    },
    removeBubbleSummary: (chatId, summaryId) => {
      const chats = get().chats;
      if (chats) set({ chats: chats.map(chat => chat.id === chatId ? removeBubbleSummaryPure(chat, summaryId) : chat) });
    },
    saveBubbleSummary: (chatId: string, summary: BubbleSummary) => {
      const chats = get().chats;
      if (!chats || !isBubbleSummary(summary)) return;
      set({ chats: chats.map(chat => chat.id !== chatId ? chat : saveBubbleSummaryPure(chat, summary)) });
    },
    setSummaryForSubmit: (chatId: string, summaryId: string, use: boolean) => {
      const chats = get().chats;
      if (!chats) return;
      set({ chats: chats.map(chat => chat.id === chatId ? setSummaryForSubmitPure(chat, summaryId, use) : chat) });
    },
  };
};
