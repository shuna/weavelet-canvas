import React, { createContext, useContext } from 'react';
import { create } from 'zustand';
import liveStore, { createStoreState, StoreState } from './store';
import { buildExportContentStore } from '@utils/contentStore';
import { switchActivePathState, switchBranchAtNodeState } from './branch-domain';
import type { ImportPreviewSource } from '@components/ImportExportChat/importService';

export type WorkspaceScope = {
  store: typeof liveStore;
  readOnly: boolean;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  selectedFolderIds: string[];
  setSelectedFolderIds: (ids: string[]) => void;
  summaryTabs?: Record<string, 'original' | 'summary' | 'compact'>;
  setSummaryTab?: (key: string, tab: 'original' | 'summary' | 'compact') => void;
};
export const WorkspaceContext = createContext<WorkspaceScope | null>(null);
export const useWorkspaceScope = () => useContext(WorkspaceContext);
export const useWorkspaceStore = () => useWorkspaceScope()?.store ?? liveStore;
export const useWorkspaceReadOnly = () => useWorkspaceScope()?.readOnly ?? false;

// These actions change browsing state only. All other actions are stopped before
// their bodies run, including external effects such as AI task invalidation.
const browsingActions = new Set([
  'setNodeCollapsed', 'setAllCollapsed', 'setFolders',
  'switchBranchAtNode', 'switchActivePath', 'switchActivePathSilent', 'ensureBranchTree',
  'setBranchEditorFocusNodeId', 'setHoveredNodeId', 'setVisibleNodeId',
  'setBranchEditorSyncEnabled', 'setChatActiveView', 'navigateToBranchEditor',
  'setPendingChatFocus', 'clearPendingChatFocus', 'saveChatScrollAnchor', 'getChatScrollAnchor', 'clearChatScrollAnchor',
  'setIsMultiView', 'setMultiViewChatIndices', 'setMultiViewPrimaryChatIndex', 'activateFolderOverview', 'setCompareTarget',
  'navigateToNode', 'pushNavigationEntry', 'captureCurrentNavigationEntry', 'updateCurrentNavigationEntryAnchor',
  'restoreNavigationEntry', 'navBack', 'navForward', 'canNavBack', 'canNavForward', 'initNavigationEntry',
  'canUndoBranch', 'canRedoBranch', 'nextResult', 'prevResult', 'toggleStarredOnly',
  'setSearchQuery', 'saveSearchQueryToHistory', 'clearSearchHistory', 'setSearchResults', 'toggleSearchScope', 'openSearch', 'closeSearch', 'toggleSearch',
  'setGrepQuery', 'executeGrep', 'setGrepMode', 'navigateToGrepResult', 'saveSidebarSearchHistory', 'clearSidebarSearchHistory', 'saveChatFindHistory', 'clearChatFindHistory',
]);
export function createPreviewStore(source: ImportPreviewSource) {
  const store = create<StoreState>()((set, get) => {
    const state = createStoreState(set, get);
    const actions = Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value === 'function')
      .map(([name, action]) => [name, browsingActions.has(name)
        ? action : () => ({ status: 'read-only' })]));
    const maps = (field: 'collapsedNodes' | 'omittedNodes' | 'protectedNodes') => Object.fromEntries(source.chats.map((chat, index) => [String(index), { ...chat[field] }]));
    const live = liveStore.getState();
    return {
      ...state, ...actions,
      ...structuredClone({
        chats: source.chats, folders: source.folders, contentStore: buildExportContentStore(source.contentStore), evaluationResults: source.evaluationResults,
        favoriteModels: live.favoriteModels, providers: live.providers, localModels: live.localModels,
        savedModelMeta: live.savedModelMeta, providerCustomModels: live.providerCustomModels, providerModelCache: live.providerModelCache, safetyThresholds: live.safetyThresholds, qualityThresholds: live.qualityThresholds,
      }),
      inlineLatex: live.inlineLatex, markdownMode: live.markdownMode, streamingMarkdownPolicy: live.streamingMarkdownPolicy,
      advancedMode: live.advancedMode, menuWidth: live.menuWidth, displayChatSize: live.displayChatSize,
      branchSwipeDirection: live.branchSwipeDirection, hideSideMenu: false,
      currentChatIndex: source.chats.length ? 0 : -1,
      collapsedNodeMaps: maps('collapsedNodes'), omittedNodeMaps: maps('omittedNodes'), protectedNodeMaps: maps('protectedNodes'),
      setFolders: (folders: StoreState['folders']) => set({ folders: Object.fromEntries(Object.entries(get().folders).map(([id, folder]) => [id, { ...folder, expanded: folders[id]?.expanded ?? folder.expanded }])) }),
      switchActivePath: (index: number, path: string[]) => set({ chats: switchActivePathState(get().chats!, index, path, get().contentStore) }),
      switchActivePathSilent: (index: number, path: string[]) => set({ chats: switchActivePathState(get().chats!, index, path, get().contentStore) }),
      switchBranchAtNode: (index: number, node: string) => set({ chats: switchBranchAtNodeState(get().chats!, index, node, get().contentStore) }),
      canUndoBranch: () => false, canRedoBranch: () => false,
      setCurrentChatIndex: (currentChatIndex: number) => set({ currentChatIndex }),
      setHideSideMenu: (hideSideMenu: boolean) => set({ hideSideMenu }),
      setMenuWidth: (menuWidth: number) => set({ menuWidth }),
      setSplitPanelRatio: (splitPanelRatio: number) => set({ splitPanelRatio }),
      setSplitPanelSwapped: (splitPanelSwapped: boolean) => set({ splitPanelSwapped }),
    } as StoreState;
  });
  return store as typeof liveStore;
}
