import { describe, expect, it } from 'vitest';
import { isSplitView, isBranchEditorVisible } from '@type/chat';
import { createPartializedState, createLocalStoragePartializedState } from './persistence';
import type { StoreState } from './store';
import type { StoreApi } from 'zustand';
import { createConfigSlice } from './config-slice';
import { splitPanelRatio } from '../../shared/google-sync/advancedDisplay';

describe('ChatView helpers', () => {
  it('isSplitView returns true for split views only', () => {
    expect(isSplitView('split-horizontal')).toBe(true);
    expect(isSplitView('split-vertical')).toBe(true);
    expect(isSplitView('chat')).toBe(false);
    expect(isSplitView('branch-editor')).toBe(false);
  });

  it('isBranchEditorVisible returns true for branch-editor and split views', () => {
    expect(isBranchEditorVisible('branch-editor')).toBe(true);
    expect(isBranchEditorVisible('split-horizontal')).toBe(true);
    expect(isBranchEditorVisible('split-vertical')).toBe(true);
    expect(isBranchEditorVisible('chat')).toBe(false);
  });
});

describe('split view persistence', () => {
  it('uses the shared split ratio clamp in the Web setter and native bridge', () => {
    let state: StoreState;
    const get = () => state;
    const set = ((patch: Partial<StoreState> | ((previous: StoreState) => Partial<StoreState>)) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    }) as StoreApi<StoreState>['setState'];
    state = createConfigSlice(set, get) as StoreState;
    for (const [input, expected] of [[0.1, 0.2], [0.4, 0.4], [0.9, 0.8]]) {
      state.setSplitPanelRatio(input);
      expect(state.splitPanelRatio).toBe(expected);
      expect(JSON.parse(splitPanelRatio(JSON.stringify({ ratio: input })))).toBe(expected);
    }
  });

  it('defaults are persisted correctly', () => {
    const fakeState = {
      splitPanelRatio: 0.5,
      splitPanelSwapped: false,
      chatActiveView: 'chat',
      chats: [],
      contentStore: {},
      branchClipboard: null,
    } as unknown as StoreState;

    const persisted = createPartializedState(fakeState);
    expect(persisted.splitPanelRatio).toBe(0.5);
    expect(persisted.splitPanelSwapped).toBe(false);
    expect(persisted.chatActiveView).toBe('chat');
  });
});
