import { describe, expect, it, vi } from 'vitest';

import { createNavigationSlice, type NavigationSlice } from './navigation-slice';

type TestState = NavigationSlice & Record<string, any>;

function createState() {
  let state: TestState = {
    chats: [
      { id: 'chat-a', branchTree: { activePath: ['a'], nodes: { a: {} } } },
      { id: 'chat-b', branchTree: { activePath: ['b'], nodes: { b: {} } } },
    ],
    currentChatIndex: 0,
    chatActiveView: 'chat',
    getChatScrollAnchor: vi.fn((id: string) => id === 'chat-a'
      ? { firstVisibleItemIndex: 2, offsetWithinItem: 321, wasAtBottom: false, nodeId: 'a' }
      : { firstVisibleItemIndex: 1, offsetWithinItem: 211, wasAtBottom: false, nodeId: 'b' }),
    setCurrentChatIndex: vi.fn(),
    switchActivePathSilent: vi.fn(),
    setChatActiveView: vi.fn(),
    setBranchEditorFocusNodeId: vi.fn(),
    setPendingChatFocus: vi.fn(),
  } as unknown as TestState;
  const set = (partial: Partial<TestState>) => { state = { ...state, ...partial }; };
  state = { ...state, ...createNavigationSlice(set as never, () => state as never) };
  return () => state;
}

describe('navigation-slice', () => {
  it('keeps the departing viewport and restores the destination viewport', () => {
    const get = createState();
    get().pushNavigationEntry({ chatId: 'chat-a', activePath: ['a'], source: 'scroll' });
    get().pushNavigationEntry({ chatId: 'chat-b', activePath: ['b'], source: 'chat-switch' });

    expect(get().navHistoryPast[0].scrollAnchor).toMatchObject({ nodeId: 'a', offsetWithinItem: 321 });
    expect(get().navHistoryCurrent!.scrollAnchor).toMatchObject({ nodeId: 'b', offsetWithinItem: 211 });

    get().navBack();
    expect(get().navHistoryCurrent!.chatId).toBe('chat-a');
    expect(get().navHistoryFuture[0].scrollAnchor).toMatchObject({ nodeId: 'b', offsetWithinItem: 211 });
  });

  it('uses focus only when the entry has no viewport anchor', () => {
    const get = createState();
    get().restoreNavigationEntry({
      key: 'focus-only', chatId: 'chat-a', activePath: ['a'], focusedNodeId: 'a', viewContext: 'chat', source: 'branch-editor',
    });
    expect(get().setPendingChatFocus).toHaveBeenCalledWith({ chatIndex: 0, nodeId: 'a' });
  });

  it('does not overwrite the scroll operation departure with its arrival', () => {
    const get = createState();
    get().getChatScrollAnchor.mockReturnValue({ firstVisibleItemIndex: 0, offsetWithinItem: 10, wasAtBottom: false, nodeId: 'a' });
    get().pushNavigationEntry({ chatId: 'chat-a', activePath: ['a'], source: 'scroll' });
    get().getChatScrollAnchor.mockReturnValue({ firstVisibleItemIndex: 3, offsetWithinItem: 500, wasAtBottom: false, nodeId: 'a' });
    get().pushNavigationEntry({ chatId: 'chat-a', activePath: ['a'], source: 'scroll' });

    expect(get().navHistoryPast[0].scrollAnchor?.offsetWithinItem).toBe(10);
    expect(get().navHistoryCurrent!.scrollAnchor?.offsetWithinItem).toBe(500);
  });

  it('lets an explicit navigation replace an unfinished restoration without a visible scroller', () => {
    const get = createState();
    get().pushNavigationEntry({ chatId: 'chat-a', activePath: ['a'], source: 'scroll' });
    get().restoreNavigationEntry(get().navHistoryCurrent!);
    get().getChatScrollAnchor.mockReturnValue({ firstVisibleItemIndex: 1, offsetWithinItem: 777, wasAtBottom: false, nodeId: 'a' });

    get().pushNavigationEntry({ chatId: 'chat-a', activePath: ['a'], source: 'chat-switch' });

    expect(get().isRestoringNavigation).toBe(false);
    expect(get().navHistoryPast[0].scrollAnchor?.offsetWithinItem).toBe(321);
  });
});
