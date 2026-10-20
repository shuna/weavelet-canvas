import { isMessageVisible } from '@utils/advancedDisplay';
import { useSyncReview, acknowledgeSyncChat } from '@store/storage/google/conflicts';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceStore, useWorkspaceReadOnly } from '@store/workspaceScope';
import { useTranslation } from 'react-i18next';

import ScrollToBottomButton from './ScrollToBottomButton';
import CollapseAllButtons from './CollapseAllButtons';
import ChatFindBar from './ChatFindBar';
import Message from './Message';
import NewMessageButton from './Message/NewMessageButton';
import CrossIcon from '@icon/CrossIcon';

import useSubmit from '@hooks/useSubmit';
import { recoverPending } from '@hooks/useStreamRecovery';
import { getAllPending } from '@utils/streamDb';
import { MessageInterface, TextContentInterface } from '@type/chat';
import countTokens, { limitMessageTokens } from '@utils/messageUtils';
import { perfStart, perfEnd } from '@utils/perfTrace';
import { defaultModel, reduceMessagesToTotalToken } from '@constants/chat';
import { showToast } from '@utils/showToast';
import { bubbleNavigationTargets, captureBubbleScrollAnchor, restoredBubbleScrollTop, shouldFollowStream, streamFollowAfterScroll } from '@utils/bubbleScroll';

const EMPTY_MESSAGES: never[] = [];
const EMPTY_ACTIVE_PATH: string[] = [];
const SCROLL_ALIGN_TOLERANCE = 0.5;
const BOTTOM_THRESHOLD = 150;
const KEYBOARD_VIEWPORT_DELTA_THRESHOLD = 50;
const SCROLL_NAV_DEBOUNCE_MS = 300;
type ScrollBehaviorMode = 'auto' | 'smooth';
const MESSAGE_EDIT_TEXTAREA_SELECTOR = 'textarea[data-message-editing="true"]';
const MESSAGE_ITEM_SELECTOR = '[data-item-index]';

type ActiveElementLike = {
  tagName?: string;
  matches?: (selector: string) => boolean;
} | null;

type ScrollerLike = {
  contains: (element: any) => boolean;
} | null;

export function isEditingMessageInScroller(scroller: HTMLElement | null): boolean {
  if (!scroller || typeof document === 'undefined') return false;
  return isEditingMessageElement(scroller, document.activeElement);
}

export function isEditingMessageElement(
  scroller: ScrollerLike,
  activeElement: ActiveElementLike
): boolean {
  if (
    !scroller ||
    !activeElement ||
    activeElement.tagName !== 'TEXTAREA' ||
    typeof activeElement.matches !== 'function'
  ) {
    return false;
  }

  return !!(
    activeElement.matches(MESSAGE_EDIT_TEXTAREA_SELECTOR) &&
    scroller.contains(activeElement) &&
    (activeElement as HTMLElement).closest?.(MESSAGE_ITEM_SELECTOR)
  );
}

export function shouldShowHiddenMessagesWarning({
  totalTokens,
  limitedTokens,
  totalMessages,
  limitedMessages,
  tokenLimit,
}: {
  totalTokens: number;
  limitedTokens: number;
  totalMessages: number;
  limitedMessages: number;
  tokenLimit: number;
}): boolean {
  return (
    totalMessages > 0 &&
    limitedMessages > 0 &&
    limitedMessages < totalMessages &&
    totalTokens > tokenLimit &&
    limitedTokens < totalTokens
  );
}

export function scrollViewportToBottom(
  scroller: { scrollHeight: number; scrollTop: number },
  onBottomStateChange: (isAtBottom: boolean) => void
): void {
  scroller.scrollTop = scroller.scrollHeight;
  onBottomStateChange(true);
}

export function getBubbleNavigationTargets(scroller: Pick<HTMLElement,
  'getBoundingClientRect' | 'querySelectorAll' | 'scrollTop' | 'scrollHeight' | 'clientHeight'
> | null): { previous: number; next: number } {
  if (!scroller) return { previous: -1, next: -1 };

  const viewportTop = scroller.getBoundingClientRect().top;
  return bubbleNavigationTargets({
    items: Array.from(scroller.querySelectorAll<HTMLElement>(MESSAGE_ITEM_SELECTOR)).map(item => ({
      index: Number(item.dataset.itemIndex), top: item.getBoundingClientRect().top - viewportTop,
    })),
    scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target.isContentEditable
  );
}

interface ChatContentProps {
  isChatFindOpen?: boolean;
  onChatFindClose?: () => void;
}

const ChatContent = ({ isChatFindOpen, onChatFindClose }: ChatContentProps = {}) => {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();

  const { t } = useTranslation();
  const inputRole = useStore((state) => state.inputRole);
  const setError = useStore((state) => state.setError);
  const setChats = useStore((state) => state.setChats);
  const messages = useStore((state) =>
    state.chats &&
    state.chats.length > 0 &&
    state.currentChatIndex >= 0 &&
    state.currentChatIndex < state.chats.length
      ? (state.chats[state.currentChatIndex].messages ?? EMPTY_MESSAGES)
      : EMPTY_MESSAGES
  );
  const reviewChatId = useStore(state => state.chats?.[state.currentChatIndex]?.id ?? '');
  const syncChanged = useSyncReview(state => !readOnly && state.chats.includes(reviewChatId));
  const currentChatIndex = useStore((state) => state.currentChatIndex);
  const stickyIndex = useStore((state) =>
    state.chats &&
    state.chats.length > 0 &&
    state.currentChatIndex >= 0 &&
    state.currentChatIndex < state.chats.length
      ? (state.chats[state.currentChatIndex].messages?.length ?? 0)
      : 0
  );
  const advancedMode = useStore((state) => state.advancedMode);
  const animateBubbleNavigation = useStore((state) => state.animateBubbleNavigation);
  const currentChatId = useStore((state) =>
    state.chats?.[state.currentChatIndex]?.id ?? ''
  );
  const activePath = useStore((state) =>
    state.chats?.[state.currentChatIndex]?.branchTree?.activePath ?? EMPTY_ACTIVE_PATH
  );
  const isCurrentChatGenerating = useStore((state) =>
    Object.values(state.generatingSessions).some((s) => s.chatId === currentChatId)
  );
  const pushNavigationEntry = useStore((state) => state.pushNavigationEntry);
  const captureCurrentNavigationEntry = useStore((state) => state.captureCurrentNavigationEntry);
  const updateCurrentNavigationEntryAnchor = useStore((state) => state.updateCurrentNavigationEntryAnchor);
  const chatActiveView = useStore((state) => state.chatActiveView);
  const navEntry = useStore((state) => state.navHistoryCurrent);
  const isRestoringNavigation = useStore((state) => state.isRestoringNavigation);

  const model = useStore((state) =>
    state.chats &&
    state.chats.length > 0 &&
    state.currentChatIndex >= 0 &&
    state.currentChatIndex < state.chats.length
      ? state.chats[state.currentChatIndex].config.model
      : defaultModel
  );
  // Track async token-limited messages. When `messages` changes, the derived
  // `messagesLimited` falls back to `messages` immediately (no render-time
  // setState needed), then updates once the async limiting completes.
  const [asyncLimited, setAsyncLimited] = React.useState<{
    source: MessageInterface[];
    limited: MessageInterface[];
  }>({ source: messages, limited: messages });
  const messagesLimited =
    asyncLimited.source === messages ? asyncLimited.limited : messages;

  useEffect(() => {
    let cancelled = false;

    limitMessageTokens(messages, reduceMessagesToTotalToken, model).then((nextMessages) => {
      if (!cancelled) setAsyncLimited({ source: messages, limited: nextMessages });
    });

    return () => {
      cancelled = true;
    };
  }, [messages, model]);

  const handleReduceMessages = () => {
    const confirmMessage = t('reduceMessagesWarning');
    if (window.confirm(confirmMessage)) {
      const chats = useStore.getState().chats!;
      const removedMessagesCount = messages.length - messagesLimited.length;
      const updatedChats = chats.slice();
      updatedChats[currentChatIndex] = { ...chats[currentChatIndex], messages: messagesLimited };
      setChats(updatedChats);
      useStore.getState().setToastShow(false);
      showToast(t('reduceMessagesSuccess', { count: removedMessagesCount }), 'success');
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!readOnly && !isCurrentChatGenerating) {
      if (messagesLimited.length > 0 && messagesLimited.length < messages.length) {
        Promise.all([
          countTokens(messages, model),
          countTokens(messagesLimited, model),
        ]).then(([allTokens, limitedTokens]) => {
          if (cancelled) return;
          if (
            !shouldShowHiddenMessagesWarning({
              totalTokens: allTokens,
              limitedTokens,
              totalMessages: messages.length,
              limitedMessages: messagesLimited.length,
              tokenLimit: reduceMessagesToTotalToken,
            })
          ) {
            return;
          }
          const hiddenTokens = allTokens - limitedTokens;
          showToast(t('hiddenMessagesWarning', { hiddenTokens, reduceMessagesToTotalToken }), 'warning');
        });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [messagesLimited, isCurrentChatGenerating, messages, model]);

  // clear error at the start of generating new messages
  useEffect(() => {
    if (isCurrentChatGenerating) {
      setError('');
    }
  }, [isCurrentChatGenerating]);

  const { error, handleRetry } = useSubmit();
  const lastSubmitMode = useStore((state) => state.lastSubmitMode);
  const proxyActive = useStore((state) => state.proxyEnabled && !!state.proxyEndpoint);
  const setLastSubmitContext = useStore((state) => state.setLastSubmitContext);
  const [hasPendingRecords, setHasPendingRecords] = useState(false);

  useEffect(() => {
    let disposed = false;
    setHasPendingRecords(false);
    if (!readOnly && error && proxyActive) {
      getAllPending()
        .then((records) => {
          if (!disposed) setHasPendingRecords(records.some(record => record.chatId === currentChatId && !!record.proxySessionId));
        })
        .catch(() => { if (!disposed) setHasPendingRecords(false); });
    }
    return () => { disposed = true; };
  }, [error, proxyActive, currentChatId]);

  // Scroller refs — simplified from Virtuoso's dual-ref pattern
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [atTop, setAtTop] = useState(true);
  const [isEditingInScroller, setIsEditingInScroller] = useState(false);
  const [bubbleNavigationState, setBubbleNavigationState] = useState({
    canMoveUp: false,
    canMoveDown: false,
  });

  const scrollerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    (scrollerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setScrollerElement(el);
  }, []);

  // Scroll anchor tracking (local refs, saved to store on departure)
  const saveChatScrollAnchor = useStore((state) => state.saveChatScrollAnchor);
  const getChatScrollAnchor = useStore((state) => state.getChatScrollAnchor);
  const anchorRef = useRef<ReturnType<typeof captureBubbleScrollAnchor>>({ firstVisibleItemIndex: 0, offsetWithinItem: 0, wasAtBottom: true, nodeId: undefined as string | undefined, scrollTop: 0 });
  const atBottomRef = useRef(true);
  const streamFollowRef = useRef(true);
  const streamScrollerRef = useRef<HTMLElement | null>(null);
  const streamScrollTopRef = useRef(0);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const previousStreamRef = useRef({ key: '', generating: false });
  const scrollLayoutKey = JSON.stringify([currentChatId, activePath]);
  const pendingEditStateSyncRef = useRef<number | null>(null);
  const saveAnchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explicitScrollNavigationRef = useRef(false);
  const explicitScrollClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll-based navigation history tracking
  const prevTopBubbleNodeIdRef = useRef<string | null>(null);
  const scrollNavDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build visible items list from messages (not messagesLimited) to stay
  // in sync with activePath. messagesLimited is only used for token warnings.
  const items = useMemo(() => {
    const result: Array<{ message: MessageInterface; originalIndex: number }> = [];
    messages?.forEach((message, index) => {
      if (!isMessageVisible(advancedMode, index, message.role)) return;
      result.push({ message, originalIndex: index });
    });
    return result;
  }, [messages, advancedMode]);

  const updateBubbleNavigationState = useCallback(() => {
    const { previous, next } = getBubbleNavigationTargets(scrollerRef.current);
    setBubbleNavigationState({ canMoveUp: previous >= 0, canMoveDown: next >= 0 });
  }, []);

  // Save scroll anchor to store (called on chat departure / unmount)
  const saveCurrentAnchor = useCallback(() => {
    if (!currentChatId) return;
    saveChatScrollAnchor(currentChatId, {
      ...anchorRef.current,
    });
  }, [currentChatId, saveChatScrollAnchor]);

  // Save anchor when chat changes or component unmounts
  const prevChatIdRef = useRef(currentChatId);
  useEffect(() => {
    if (prevChatIdRef.current && prevChatIdRef.current !== currentChatId) {
      saveChatScrollAnchor(prevChatIdRef.current, {
        ...anchorRef.current,
      });
    }
    prevChatIdRef.current = currentChatId;
    // Reset scroll nav tracking on chat switch
    prevTopBubbleNodeIdRef.current = null;
  }, [currentChatId, saveChatScrollAnchor]);

  useEffect(() => {
    return () => {
      saveCurrentAnchor();
    };
  }, [saveCurrentAnchor]);

  useLayoutEffect(() => {
    const previous = previousStreamRef.current;
    previousStreamRef.current = { key: scrollLayoutKey, generating: isCurrentChatGenerating };
    const content = scrollContentRef.current;
    const scroller = scrollerElement;
    if (!content || !scroller) return;
    if (previous.key !== scrollLayoutKey || isCurrentChatGenerating) {
      content.style.minHeight = '';
      return;
    }
    if (!previous.generating) return;

    streamFollowRef.current = false;
    const top = streamScrollTopRef.current;
    // Keep the old position reachable even while lazy Markdown temporarily shrinks.
    content.style.minHeight = `${top + scroller.clientHeight}px`;
    scroller.scrollTop = top;
    streamScrollTopRef.current = scroller.scrollTop;
  }, [isCurrentChatGenerating, scrollLayoutKey, scrollerElement]);

  // --- Scroll event: atBottom + anchor tracking ---
  useEffect(() => {
    const scroller = scrollerElement;
    if (!scroller) return;

    const onScroll = (event?: Event) => {
      if (scroller.clientHeight === 0) {
        setBubbleNavigationState({ canMoveUp: false, canMoveDown: false });
        return;
      }
      const content = scrollContentRef.current;
      if (event && content?.style.minHeight) {
        // Release spare space as the user scrolls up, without moving their viewport.
        content.style.minHeight = `${scroller.scrollTop + scroller.clientHeight}px`;
      }
      const isBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_THRESHOLD;
      const isTop = scroller.scrollTop < BOTTOM_THRESHOLD;
      setAtBottom(isBottom);
      setAtTop(isTop);
      atBottomRef.current = isBottom;

      // Anchor update must remain exact even within the visual "at bottom" threshold.
      const scrollerRect = scroller.getBoundingClientRect();
      const nodeItems = scroller.querySelectorAll<HTMLElement>(MESSAGE_ITEM_SELECTOR);
      const anchorItems = [];
      for (const item of nodeItems) {
        const rect = item.getBoundingClientRect();
        anchorItems.push({ index: Number(item.dataset.itemIndex), nodeId: item.dataset.nodeId, top: rect.top - scrollerRect.top, bottom: rect.bottom - scrollerRect.top });
        if (rect.bottom > scrollerRect.top) break;
      }
      const capturedAnchor = captureBubbleScrollAnchor({
        items: anchorItems,
        scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      });
      anchorRef.current = capturedAnchor;
      // Layout measurements must not change the user's streaming follow choice.
      const scrollerChanged = streamScrollerRef.current !== scroller;
      if (event || scrollerChanged) {
        streamFollowRef.current = streamFollowAfterScroll({
          following: streamFollowRef.current, previousScrollTop: streamScrollTopRef.current,
          scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
          scrollEvent: !!event, scrollerChanged,
        });
        streamScrollerRef.current = scroller;
        streamScrollTopRef.current = scroller.scrollTop;
      }
      // Keep navigation departures accurate without writing on every scroll event.
      if (saveAnchorTimerRef.current) clearTimeout(saveAnchorTimerRef.current);
      saveAnchorTimerRef.current = setTimeout(() => {
        saveAnchorTimerRef.current = null;
        saveCurrentAnchor();
      }, SCROLL_NAV_DEBOUNCE_MS);

      updateBubbleNavigationState();

      // Scroll-based navigation history: detect top bubble change
      const topItemIndex = anchorRef.current.firstVisibleItemIndex;
      const topNodeId = activePath[items[topItemIndex]?.originalIndex] ?? null;
      if (topNodeId && topNodeId !== prevTopBubbleNodeIdRef.current) {
        if (scrollNavDebounceRef.current) clearTimeout(scrollNavDebounceRef.current);
        scrollNavDebounceRef.current = setTimeout(() => {
          scrollNavDebounceRef.current = null;
          const state = useStore.getState();
          if (state.isRestoringNavigation) return;
          if (Object.values(state.generatingSessions).some((s: any) => s.chatId === currentChatId)) return;
          if (explicitScrollNavigationRef.current) {
            explicitScrollNavigationRef.current = false;
            updateCurrentNavigationEntryAnchor();
            return;
          }
          if (prevTopBubbleNodeIdRef.current === null) {
            // First detection after mount / chat switch — just record, don't push
            prevTopBubbleNodeIdRef.current = topNodeId;
            return;
          }
          prevTopBubbleNodeIdRef.current = topNodeId;
          const chat = state.chats?.[state.currentChatIndex];
          if (!chat?.branchTree) return;
          pushNavigationEntry({
            chatId: chat.id,
            activePath: [...chat.branchTree.activePath],
            focusedNodeId: topNodeId,
            viewContext: state.chatActiveView,
            source: 'scroll',
          });
        }, SCROLL_NAV_DEBOUNCE_MS);
      }
    };

    // Sync initial state before any scroll event fires
    onScroll();

    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(updateBubbleNavigationState);
    observer.observe(scroller);
    const messageList = scroller.querySelector('[data-message-list]');
    if (messageList) observer.observe(messageList);
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      if (scrollNavDebounceRef.current) clearTimeout(scrollNavDebounceRef.current);
      if (saveAnchorTimerRef.current) clearTimeout(saveAnchorTimerRef.current);
      if (explicitScrollClearRef.current) clearTimeout(explicitScrollClearRef.current);
    };
  }, [scrollerElement, updateBubbleNavigationState, activePath, items, currentChatId, pushNavigationEntry, updateCurrentNavigationEntryAnchor]);

  // --- Streaming auto-follow via ResizeObserver ---
  const syncAtBottomState = useCallback((isBottom: boolean) => {
    atBottomRef.current = isBottom;
    setAtBottom(isBottom);
  }, []);

  useEffect(() => {
    if (!isCurrentChatGenerating) return;
    if (isEditingInScroller) return;

    const scroller = scrollerElement;
    const messageList = scroller?.querySelector('[data-message-list]');
    if (!scroller || !messageList) return;

    const scrollToEnd = () => {
      const generating = Object.values(useStore.getState().generatingSessions).some(session => session.chatId === currentChatId);
      if (!shouldFollowStream({ following: streamFollowRef.current, generating, editing: isEditingInScroller, branchSwiping: !!scroller.dataset.branchSwiping })) return;
      scrollViewportToBottom(scroller, syncAtBottomState);
      streamScrollTopRef.current = scroller.scrollTop;
    };

    // Scroll to end immediately
    scrollToEnd();

    // ResizeObserver to follow content height changes
    const observer = new ResizeObserver(scrollToEnd);
    observer.observe(scroller);
    observer.observe(messageList);
    const footer = messageList.nextElementSibling;
    if (footer) observer.observe(footer);

    // Also observe individual message elements for streaming text growth
    const observeMessages = () => {
      const msgs = messageList.querySelectorAll('[data-item-index]');
      msgs.forEach((msg) => observer.observe(msg));
    };
    observeMessages();

    // Re-observe when new message elements are added
    const mutationObserver = new MutationObserver(() => {
      observeMessages();
      scrollToEnd();
    });
    mutationObserver.observe(messageList, { childList: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [isCurrentChatGenerating, isEditingInScroller, scrollerElement, currentChatId, syncAtBottomState, useStore]);

  // Restore scroll anchor on mount
  const pendingChatFocus = useStore((state) => state.pendingChatFocus);
  const clearPendingChatFocus = useStore((state) => state.clearPendingChatFocus);

  // Handle pendingChatFocus — reacts to focus changes (including same-chat branch editor return)
  useEffect(() => {
    if (!pendingChatFocus || pendingChatFocus.chatIndex !== currentChatIndex) return;
    const nodeId = pendingChatFocus.nodeId;
    const pathIndex = activePath.indexOf(nodeId);
    if (pathIndex < 0) return;
    const itemIndex = items.findIndex((item) => item.originalIndex === pathIndex);
    if (itemIndex < 0) return;

    clearPendingChatFocus();
    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const item = scroller?.querySelector<HTMLElement>(`[data-item-index="${itemIndex}"]`);
      if (!item || !scroller) return;
      const scrollerHeight = scroller.clientHeight;
      const itemHeight = item.offsetHeight;
      item.scrollIntoView({
        block: itemHeight > scrollerHeight ? 'start' : 'center',
        behavior: 'smooth',
      });
    });
  }, [pendingChatFocus, currentChatIndex, activePath, items, clearPendingChatFocus]);

  // A history entry owns its exact viewport anchor.  Layout can settle after
  // React has rendered, so observe it briefly and always stop on interaction.
  useEffect(() => {
    if (!isRestoringNavigation || navEntry?.chatId !== currentChatId || !navEntry.scrollAnchor) return;

    let frame = 0;
    let stopped = false;
    const restore = () => {
      const scroller = scrollerRef.current;
      const anchor = navEntry.scrollAnchor;
      if (stopped || !scroller || !anchor || scroller.clientHeight === 0) return;
      const item = anchor.nodeId
        ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-node-id]')).find((element) => element.dataset.nodeId === anchor.nodeId)
        : scroller.querySelector<HTMLElement>(`[data-item-index="${anchor.firstVisibleItemIndex}"]`);
      const scrollerTop = scroller.getBoundingClientRect().top;
      const desired = restoredBubbleScrollTop({
        anchor, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
        itemTop: item ? item.getBoundingClientRect().top - scrollerTop : undefined,
      });
      if (desired != null) scroller.scrollTop = desired;
    };
    const observer = new ResizeObserver(restore);
    const mutations = new MutationObserver(restore);
    const scroller = scrollerRef.current;
    if (!scroller) return;
    observer.observe(scroller);
    const list = scroller?.querySelector('[data-message-list]');
    if (list) {
      observer.observe(list);
      mutations.observe(list, { childList: true, subtree: true });
    }
    const stop = (fromInteraction = false) => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      if (fromInteraction && useStore.getState().navHistoryCurrent?.key === navEntry.key) {
        useStore.setState({ isRestoringNavigation: false });
      }
    };
    const stopForUser = () => stop(true);
    scroller?.addEventListener('wheel', stopForUser, { passive: true });
    scroller?.addEventListener('touchstart', stopForUser, { passive: true });
    scroller?.addEventListener('pointerdown', stopForUser, { passive: true });
    window.addEventListener('keydown', stopForUser);
    frame = requestAnimationFrame(restore);
    const timeout = window.setTimeout(stop, 1100);
    return () => {
      window.clearTimeout(timeout);
      scroller?.removeEventListener('wheel', stopForUser);
      scroller?.removeEventListener('touchstart', stopForUser);
      scroller?.removeEventListener('pointerdown', stopForUser);
      window.removeEventListener('keydown', stopForUser);
      stop();
    };
  }, [isRestoringNavigation, navEntry, currentChatId]);

  // Restore saved scroll anchor on chat switch (when no pendingChatFocus)
  useEffect(() => {
    if (isRestoringNavigation) return;
    if (pendingChatFocus && pendingChatFocus.chatIndex === currentChatIndex) return;

    const anchor = getChatScrollAnchor(currentChatId);
    if (!anchor) return;
    if (anchor.wasAtBottom) return;

    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const item = scroller?.querySelector<HTMLElement>(`[data-item-index="${anchor.firstVisibleItemIndex}"]`);
      if (!scroller) return;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const desired = restoredBubbleScrollTop({
        anchor, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
        itemTop: item ? item.getBoundingClientRect().top - scrollerTop : undefined,
      });
      if (desired != null) scroller.scrollTop = desired;
    });
  }, [currentChatIndex]); // intentionally only on chat switch (mount)


  useEffect(() => {
    perfStart('chat-render');
  }, [currentChatIndex]);
  useEffect(() => {
    perfEnd('chat-render');
  }, [items]);

  useEffect(() => {
    updateBubbleNavigationState();
  }, [currentChatIndex, items.length, updateBubbleNavigationState]);

  const recordExplicitScrollNavigation = useCallback(() => {
    const state = useStore.getState();
    const chat = state.chats?.[state.currentChatIndex];
    if (!chat) return;
    captureCurrentNavigationEntry();
    pushNavigationEntry({
      chatId: chat.id,
      activePath: [...(chat.branchTree?.activePath ?? [])],
      viewContext: state.chatActiveView,
      source: 'scroll',
    });
    explicitScrollNavigationRef.current = true;
    if (explicitScrollClearRef.current) clearTimeout(explicitScrollClearRef.current);
    explicitScrollClearRef.current = setTimeout(() => {
      explicitScrollNavigationRef.current = false;
      explicitScrollClearRef.current = null;
    }, 1000);
  }, [captureCurrentNavigationEntry, pushNavigationEntry]);

  const handleScrollToTop = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollTop <= SCROLL_ALIGN_TOLERANCE) return;
    recordExplicitScrollNavigation();
    scroller.scrollTo({
      top: 0,
      behavior: animateBubbleNavigation ? 'smooth' : 'auto',
    });
  }, [animateBubbleNavigation, recordExplicitScrollNavigation]);

  const handleScrollToBottom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - SCROLL_ALIGN_TOLERANCE) return;
    recordExplicitScrollNavigation();
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: animateBubbleNavigation ? 'smooth' : 'auto',
    });
  }, [animateBubbleNavigation, recordExplicitScrollNavigation]);

  const scrollToBubbleAtIndex = useCallback((index: number) => {
    if (index < 0 || index >= items.length) return;
    const scroller = scrollerRef.current;
    const item = scroller?.querySelector<HTMLElement>(`[data-item-index="${index}"]`);
    if (!item) return;
    recordExplicitScrollNavigation();
    item.scrollIntoView({
      block: 'start',
      behavior: animateBubbleNavigation ? 'smooth' : 'auto',
    });
  }, [animateBubbleNavigation, items.length, recordExplicitScrollNavigation]);

  const handleScrollToPreviousBubble = useCallback(() => {
    scrollToBubbleAtIndex(getBubbleNavigationTargets(scrollerRef.current).previous);
  }, [scrollToBubbleAtIndex]);

  const handleScrollToNextBubble = useCallback(() => {
    scrollToBubbleAtIndex(getBubbleNavigationTargets(scrollerRef.current).next);
  }, [scrollToBubbleAtIndex]);

  const { canMoveUp, canMoveDown } = bubbleNavigationState;

  // --- Focus tracking for isEditingInScroller ---
  useEffect(() => {
    if (!scrollerElement) return;

    const onFocusIn = (event: FocusEvent) => {
      if (pendingEditStateSyncRef.current != null) {
        cancelAnimationFrame(pendingEditStateSyncRef.current);
        pendingEditStateSyncRef.current = null;
      }

      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement &&
        target.matches(MESSAGE_EDIT_TEXTAREA_SELECTOR) &&
        scrollerElement.contains(target) &&
        target.closest(MESSAGE_ITEM_SELECTOR)
      ) {
        setIsEditingInScroller(true);
      }
    };

    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (
        next instanceof HTMLTextAreaElement &&
        next.matches(MESSAGE_EDIT_TEXTAREA_SELECTOR) &&
        scrollerElement.contains(next) &&
        next.closest(MESSAGE_ITEM_SELECTOR)
      ) {
        return;
      }

      pendingEditStateSyncRef.current = requestAnimationFrame(() => {
        pendingEditStateSyncRef.current = null;
        setIsEditingInScroller(isEditingMessageInScroller(scrollerElement));
      });
    };

    scrollerElement.addEventListener('focusin', onFocusIn);
    scrollerElement.addEventListener('focusout', onFocusOut);

    return () => {
      if (pendingEditStateSyncRef.current != null) {
        cancelAnimationFrame(pendingEditStateSyncRef.current);
        pendingEditStateSyncRef.current = null;
      }
      scrollerElement.removeEventListener('focusin', onFocusIn);
      scrollerElement.removeEventListener('focusout', onFocusOut);
    };
  }, [scrollerElement]);

  // --- Keyboard viewport resize handling ---
  useEffect(() => {
    if (!scrollerElement || typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    let prevHeight = viewport.height;
    let didShrinkWhileEditingMessage = false;

    const onResize = () => {
      const delta = viewport.height - prevHeight;
      prevHeight = viewport.height;

      if (Math.abs(delta) < KEYBOARD_VIEWPORT_DELTA_THRESHOLD) return;

      const activeElement = document.activeElement;
      const isEditingMessage =
        activeElement instanceof HTMLElement &&
        activeElement.matches(MESSAGE_EDIT_TEXTAREA_SELECTOR);

      if (delta < 0 && isEditingMessage) {
        didShrinkWhileEditingMessage = true;
        requestAnimationFrame(() => {
          activeElement.scrollIntoView({
            block: 'center',
            behavior: 'auto',
          });
        });
        return;
      }

      if (delta > 0 && didShrinkWhileEditingMessage) {
        didShrinkWhileEditingMessage = false;
      }
    };

    viewport.addEventListener('resize', onResize);
    return () => viewport.removeEventListener('resize', onResize);
  }, [scrollerElement]);

  // --- Keyboard bubble navigation ---
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (isEditingInScroller || isEditableTarget(event.target)) return;

      event.preventDefault();
      if (event.key === 'ArrowUp') {
        handleScrollToPreviousBubble();
      } else {
        handleScrollToNextBubble();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleScrollToNextBubble, handleScrollToPreviousBubble, isEditingInScroller]);

  const computeItemKey = useCallback((index: number) => {
    return activePath[items[index].originalIndex] ?? `${currentChatId}:${items[index].originalIndex}`;
  }, [activePath, items, currentChatId]);

  return (
    <div className='flex-1 overflow-hidden'>
      <div className='h-full bg-white dark:bg-gray-800 relative'>
        <ScrollToBottomButton
          atBottom={atBottom}
          atTop={atTop}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          scrollToTop={handleScrollToTop}
          scrollToPreviousBubble={handleScrollToPreviousBubble}
          scrollToNextBubble={handleScrollToNextBubble}
          scrollToBottom={handleScrollToBottom}
        />
        <CollapseAllButtons />
        {isChatFindOpen && onChatFindClose && (
          <ChatFindBar scrollerRef={scrollerRef} onClose={onChatFindClose} />
        )}

        {/* Follow/navigation owns scroll position, including stream finalization. */}
        <div
          ref={scrollerCallbackRef}
          key={currentChatIndex}
          className='h-full overflow-y-auto overflow-x-hidden overscroll-contain'
          style={{ overflowAnchor: 'none' }}
          data-chat-scroller
          data-chat-id={currentChatId}
        >
          <div ref={scrollContentRef} data-scroll-content>
          {syncChanged && <div role='status' className='flex items-center justify-between gap-3 px-7 py-2 text-sm text-amber-800 bg-amber-50 dark:bg-gray-700 dark:text-amber-200'><span>{t('drive:review.description')}</span><button type='button' className='shrink-0 underline' onClick={() => acknowledgeSyncChat(reviewChatId)}>{t('drive:review.chatDone')}</button></div>}
          <div className='relative' data-message-list>
            {items.map((item, index) => (
              <div key={computeItemKey(index)} data-item-index={index} data-node-id={activePath[item.originalIndex]}>
                <Message
                  role={item.message.role}
                  content={item.message.content}
                  messageIndex={item.originalIndex}
                  nodeId={activePath[item.originalIndex]}
                />
                {!readOnly && !isCurrentChatGenerating && advancedMode && (
                  <NewMessageButton
                    messageIndex={item.originalIndex}
                    nodeId={activePath[item.originalIndex]}
                    role={item.message.role}
                  />
                )}
              </div>
            ))}
          </div>

          <div className='flex flex-col items-center text-sm bg-white dark:bg-gray-800'>
            {!readOnly && <Message
              role={inputRole}
              content={[{ type: 'text', text: '' } as TextContentInterface]}
              messageIndex={stickyIndex}
              sticky
            />}

            {!readOnly && error !== '' && (
              <div className='relative py-2 px-3 w-3/5 mt-3 max-md:w-11/12 border rounded-md border-red-500 bg-red-500/10'>
                <div className='text-gray-600 dark:text-gray-100 text-sm whitespace-pre-wrap'>
                  {error}
                </div>
                {lastSubmitMode && (
                  <div className='flex items-center gap-2 mt-2'>
                    <button
                      className='px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors'
                      onClick={handleRetry}
                    >
                      {t('retry')}
                    </button>
                    {hasPendingRecords && (
                      <button
                        className='px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
                        onClick={() => recoverPending({ manual: true, chatId: currentChatId })}
                      >
                        {t('recoverFromProxy')}
                      </button>
                    )}
                  </div>
                )}
                <div
                  className='text-white absolute top-1 right-1 cursor-pointer'
                  onClick={() => {
                    setError('');
                    setLastSubmitContext(null, null, null, null);
                  }}
                >
                  <CrossIcon />
                </div>
              </div>
            )}
            <div className='w-full h-36'></div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatContent;
