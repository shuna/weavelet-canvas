import { v4 as uuidv4 } from 'uuid';
import { StoreSlice } from './store';
import { ChatView } from '@type/chat';
import { buildPathToLeaf } from '@utils/branchUtils';

export interface NavScrollAnchor {
  firstVisibleItemIndex: number;
  offsetWithinItem: number;
  wasAtBottom: boolean;
  nodeId?: string;
  scrollTop?: number;
}

export interface NavEntry {
  key: string;
  chatId: string;
  activePath: string[];
  focusedNodeId?: string;
  viewContext?: ChatView;
  scrollAnchor?: NavScrollAnchor;
  source: 'init' | 'branch-switch' | 'search' | 'grep' | 'branch-editor' | 'scroll' | 'chat-switch' | 'chat-click' | 'view-switch';
}

export interface NavigationSlice {
  navHistoryPast: NavEntry[];
  navHistoryCurrent: NavEntry | null;
  navHistoryFuture: NavEntry[];
  navEntryMap: Map<string, NavEntry>;

  isRestoringNavigation: boolean;
  pushNavigationEntry: (entry: Omit<NavEntry, 'key'>) => void;
  captureCurrentNavigationEntry: () => void;
  updateCurrentNavigationEntryAnchor: () => void;
  restoreNavigationEntry: (entry: NavEntry) => void;
  navBack: () => void;
  navForward: () => void;
  canNavBack: () => boolean;
  canNavForward: () => boolean;
  initNavigationEntry: () => void;
}

const MAX_HISTORY = 100;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;

function captureVisibleAnchor(chatId: string, get: () => any): boolean {
  if (typeof document === 'undefined') return false;
  const state = get();
  if (state.chats?.[state.currentChatIndex]?.id !== chatId) return false;
  const scroller = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-scroller]'))
    .find((element) => element.dataset.chatId === chatId);
  if (!scroller || scroller.clientHeight === 0) return false;
  const wasAtBottom = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 0.5;
  let firstVisibleItemIndex = -1;
  let offsetWithinItem = 0;
  let nodeId: string | undefined;
  const top = scroller.getBoundingClientRect().top;
  for (const item of scroller.querySelectorAll<HTMLElement>('[data-item-index]')) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > top) {
      firstVisibleItemIndex = Number(item.dataset.itemIndex);
      offsetWithinItem = top - rect.top;
      nodeId = item.dataset.nodeId;
      break;
    }
  }
  state.saveChatScrollAnchor?.(chatId, { firstVisibleItemIndex, offsetWithinItem, wasAtBottom, nodeId, scrollTop: scroller.scrollTop });
  return true;
}

function withSavedAnchor(entry: NavEntry, get: () => any): NavEntry {
  if (!captureVisibleAnchor(entry.chatId, get) && entry.scrollAnchor) return entry;
  const anchor = get().getChatScrollAnchor?.(entry.chatId);
  return anchor ? { ...entry, scrollAnchor: { ...anchor } } : entry;
}

function resolveChatIndex(
  chats: Array<{ id: string }> | null | undefined,
  chatId: string
): number {
  if (!chats) return -1;
  return chats.findIndex((c) => c.id === chatId);
}

export const createNavigationSlice: StoreSlice<NavigationSlice> = (
  set,
  get
) => ({
  navHistoryPast: [],
  navHistoryCurrent: null,
  navHistoryFuture: [],
  navEntryMap: new Map(),
  isRestoringNavigation: false,

  initNavigationEntry: () => {
    if (get().navHistoryCurrent) return;

    const chats = get().chats;
    const chatIndex = get().currentChatIndex;
    if (!chats || chatIndex < 0 || chatIndex >= chats.length) return;

    const chat = chats[chatIndex];
    const entry: NavEntry = {
      key: uuidv4(),
      chatId: chat.id,
      activePath: chat.branchTree
        ? [...(chats[chatIndex] as any).branchTree?.activePath ?? []]
        : [],
      viewContext: get().chatActiveView,
      source: 'init',
    };

    // Get the actual activePath from the materialized state
    if (chat.branchTree?.activePath) {
      entry.activePath = [...chat.branchTree.activePath];
    }

    const map = new Map(get().navEntryMap);
    map.set(entry.key, entry);
    set({ navHistoryCurrent: entry, navEntryMap: map });
  },

  pushNavigationEntry: (partial) => {
    // A user navigation supersedes an unfinished visual restoration.  Back/
    // forward do not use this path, so their multi-step restoration retains
    // its existing anchors.
    if (get().isRestoringNavigation) {
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = null;
      set({ isRestoringNavigation: false });
    }
    const key = uuidv4();
    const current = get().navHistoryCurrent;
    if (current && partial.source !== 'scroll') get().captureCurrentNavigationEntry();
    const capturedCurrent = get().navHistoryCurrent;
    const rawEntry: NavEntry = { ...partial, key };
    const entry = partial.source === 'scroll' || partial.chatId !== capturedCurrent?.chatId
      ? withSavedAnchor(rawEntry, get)
      : rawEntry;
    const past = [...get().navHistoryPast];

    if (capturedCurrent) {
      past.push(capturedCurrent);
      if (past.length > MAX_HISTORY) past.shift();
    }

    const map = new Map(get().navEntryMap);
    map.set(key, entry);

    set({
      navHistoryPast: past,
      navHistoryCurrent: entry,
      navHistoryFuture: [],
      navEntryMap: map,
    });
  },

  captureCurrentNavigationEntry: () => {
    if (get().isRestoringNavigation) return;
    const current = get().navHistoryCurrent;
    if (!current) return;
    set({ navHistoryCurrent: withSavedAnchor(current, get) });
  },

  updateCurrentNavigationEntryAnchor: () => {
    get().captureCurrentNavigationEntry();
  },

  restoreNavigationEntry: (entry) => {
    if (restoreTimer) clearTimeout(restoreTimer);
    set({ isRestoringNavigation: true });

    const chats = get().chats;
    const idx = resolveChatIndex(chats, entry.chatId);
    if (idx < 0) {
      set({ isRestoringNavigation: false });
      return false as any; // chatId not found
    }

    // Switch chat if needed
    if (get().currentChatIndex !== idx) {
      get().setCurrentChatIndex(idx);
    }

    // Restore activePath
    if (entry.activePath.length > 0) {
      const chat = chats![idx];
      if (chat.branchTree) {
        // Verify the path is still valid by checking first node exists
        const firstNode = entry.activePath[0];
        if (chat.branchTree.nodes[firstNode]) {
          get().switchActivePathSilent(idx, entry.activePath);
        }
        // else: path invalid, keep current activePath
      }
    }

    // Restore view context
    if (entry.viewContext && get().chatActiveView !== entry.viewContext) {
      get().setChatActiveView(entry.viewContext);
    }

    // Restore focus node (transient)
    if (entry.focusedNodeId) {
      get().setBranchEditorFocusNodeId(entry.focusedNodeId);
      if (entry.viewContext === 'chat' && !entry.scrollAnchor) {
        get().setPendingChatFocus({ chatIndex: idx, nodeId: entry.focusedNodeId });
      }
    }

    // Clear flag after a delay to allow scroll events from restore to settle
    restoreTimer = setTimeout(() => set({ isRestoringNavigation: false }), 1200);
  },

  navBack: () => {
    const past = get().navHistoryPast;
    const current = get().navHistoryCurrent;
    if (past.length === 0 || !current) return;

    const newPast = [...past];
    let target = newPast.pop()!;

    // Skip entries whose chat no longer exists
    while (
      target &&
      resolveChatIndex(get().chats, target.chatId) < 0 &&
      newPast.length > 0
    ) {
      target = newPast.pop()!;
    }
    if (resolveChatIndex(get().chats, target.chatId) < 0) return;

    get().captureCurrentNavigationEntry();
    const future = [get().navHistoryCurrent!, ...get().navHistoryFuture];

    set({
      navHistoryPast: newPast,
      navHistoryCurrent: target,
      navHistoryFuture: future,
      isRestoringNavigation: true,
    });

    get().restoreNavigationEntry(target);
  },

  navForward: () => {
    const future = get().navHistoryFuture;
    const current = get().navHistoryCurrent;
    if (future.length === 0 || !current) return;

    const newFuture = [...future];
    let target = newFuture.shift()!;

    while (
      target &&
      resolveChatIndex(get().chats, target.chatId) < 0 &&
      newFuture.length > 0
    ) {
      target = newFuture.shift()!;
    }
    if (resolveChatIndex(get().chats, target.chatId) < 0) return;

    get().captureCurrentNavigationEntry();
    const past = [...get().navHistoryPast, get().navHistoryCurrent!];

    set({
      navHistoryPast: past,
      navHistoryCurrent: target,
      navHistoryFuture: newFuture,
      isRestoringNavigation: true,
    });

    get().restoreNavigationEntry(target);
  },

  canNavBack: () => get().navHistoryPast.length > 0,
  canNavForward: () => get().navHistoryFuture.length > 0,
});
