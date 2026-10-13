import { v4 as uuidv4 } from 'uuid';
import { StoreSlice } from './store';
import { ChatView } from '@type/chat';
import { resolveNavigationTarget, navigationEntry, entryWithNavigationKey, navigationEntryWithAnchor, captureNavigationHistory, restoredNavigationPath, emptyNavigationHistory, initializeNavigationHistory, pushNavigationHistory, moveNavigationHistory, canMoveNavigationHistory } from '@utils/branchNavigation';

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
  navigateToNode: (input: { chatId: string; nodeId?: string; view?: ChatView; source: NavEntry['source']; history: 'push' | 'silent'; selectChat?: boolean; focus: 'bubble' | 'editor' | 'none' }) => 'reached' | 'chat-missing' | 'node-missing';
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
  return navigationEntryWithAnchor(entry,anchor);
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
) => {
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  return ({
  navigateToNode: ({ chatId, nodeId, view, source, history, selectChat = true, focus }) => {
    const state = get();
    const target = resolveNavigationTarget(state.chats,chatId,nodeId,source);
    if (target.status !== 'reached') return target.status;
    const {chatIndex,path} = target;
    const tree = state.chats![chatIndex].branchTree;
    if (history === 'push') state.pushNavigationEntry(navigationEntry(target,view ?? state.chatActiveView,source));
    if (tree && (path.length !== tree.activePath.length || path.some((id, index) => id !== tree.activePath[index]))) {
      state.switchActivePathSilent(chatIndex, path);
    }
    if (selectChat) state.setCurrentChatIndex(chatIndex);
    if (view !== undefined) state.setChatActiveView(view);
    if (nodeId && focus === 'editor') state.setBranchEditorFocusNodeId(nodeId);
    if (nodeId && focus === 'bubble') state.setPendingChatFocus({ chatIndex, nodeId });
    return 'reached';
  },
  ...emptyNavigationHistory(),

  isRestoringNavigation: false,

  initNavigationEntry: () => {
    const state = get();
    if (state.navHistoryCurrent || !state.chats?.[state.currentChatIndex]) return;
    set(initializeNavigationHistory(state,state.chats?.[state.currentChatIndex],uuidv4(),state.chatActiveView));
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
    const rawEntry = entryWithNavigationKey(partial,key);
    const entry = partial.source === 'scroll' || partial.chatId !== capturedCurrent?.chatId
      ? withSavedAnchor(rawEntry, get)
      : rawEntry;
    set(pushNavigationHistory(get(),entry));
  },

  captureCurrentNavigationEntry: () => {
    if (get().isRestoringNavigation) return;
    const current = get().navHistoryCurrent;
    if (!current) return;
    set(captureNavigationHistory(get(),withSavedAnchor(current,get)));
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
        const path = restoredNavigationPath(chat,entry.activePath);
        if (path) get().switchActivePathSilent(idx,path);
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
    if (!moveNavigationHistory(get(),get().chats,'back')) return;
    get().captureCurrentNavigationEntry();
    const next = moveNavigationHistory(get(),get().chats,'back')!;
    set({...next,isRestoringNavigation:true});
    get().restoreNavigationEntry(next.navHistoryCurrent!);
  },
  navForward: () => {
    if (!moveNavigationHistory(get(),get().chats,'forward')) return;
    get().captureCurrentNavigationEntry();
    const next = moveNavigationHistory(get(),get().chats,'forward')!;
    set({...next,isRestoringNavigation:true});
    get().restoreNavigationEntry(next.navHistoryCurrent!);
  },
  canNavBack: () => canMoveNavigationHistory(get(),get().chats,'back'),
  canNavForward: () => canMoveNavigationHistory(get(),get().chats,'forward'),
});
};
