import { StoreApi, create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import compressedStorage from './storage/CompressedStorage';
import { ChatSlice, createChatSlice } from './chat-slice';
import { InputSlice, createInputSlice } from './input-slice';
import { AuthSlice, createAuthSlice } from './auth-slice';
import { ConfigSlice, createConfigSlice } from './config-slice';
import { PromptSlice, createPromptSlice } from './prompt-slice';
import { ToastSlice, createToastSlice } from './toast-slice';
import { ProviderSlice, createProviderSlice } from './provider-slice';
import { BranchSlice, createBranchSlice } from './branch-slice';
import { MigrationSlice, createMigrationSlice } from './migration-slice';
import { SearchSlice, createSearchSlice } from './search-slice';
import { OpenRouterStatsSlice, createOpenRouterStatsSlice } from './openrouter-stats-slice';
import { GrepSlice, createGrepSlice } from './grep-slice';
import { NavigationSlice, createNavigationSlice } from './navigation-slice';
import { EvaluationSlice, createEvaluationSlice } from './evaluation-slice';
import { LocalModelSlice, createLocalModelSlice } from './local-model-slice';
import { STORE_VERSION } from './version';
import {
  createLocalStoragePartializedState,
  createPartializedState,
  migratePersistedState,
  rehydrateStoreState,
  mergePersistedStoreState,
  preservePersistedRootsOnReplace,
} from './persistence';
export { createPartializedState } from './persistence';

export type StoreState = ChatSlice &
  InputSlice &
  AuthSlice &
  ConfigSlice &
  PromptSlice &
  ToastSlice &
  ProviderSlice &
  BranchSlice &
  MigrationSlice &
  SearchSlice &
  OpenRouterStatsSlice &
  GrepSlice &
  NavigationSlice &
  EvaluationSlice &
  LocalModelSlice;

export type StoreSlice<T> = (
  set: StoreApi<StoreState>['setState'],
  get: StoreApi<StoreState>['getState']
) => T;

export const createStoreState: (set: StoreApi<StoreState>['setState'], get: StoreApi<StoreState>['getState']) => StoreState = (set, get) => ({
  ...createChatSlice(set, get),
  ...createInputSlice(set, get),
  ...createAuthSlice(set, get),
  ...createConfigSlice(set, get),
  ...createPromptSlice(set, get),
  ...createToastSlice(set, get),
  ...createProviderSlice(set, get),
  ...createBranchSlice(set, get),
  ...createMigrationSlice(set, get),
  ...createSearchSlice(set, get),
  ...createOpenRouterStatsSlice(set, get),
  ...createGrepSlice(set, get),
  ...createNavigationSlice(set, get),
  ...createEvaluationSlice(set, get),
  ...createLocalModelSlice(set, get),
});

const useStore = create<StoreState>()(
  persist(
    (originalSet, get, api) => {
      const set = preservePersistedRootsOnReplace(originalSet);
      api.setState = preservePersistedRootsOnReplace(api.setState);
      return createStoreState(set, get);
    },
    {
      name: 'free-chat-gpt',
      storage: createJSONStorage(() => compressedStorage),
      partialize: (state) => createLocalStoragePartializedState(state),
      version: STORE_VERSION,
      merge: (persisted, current) => mergePersistedStoreState(current, persisted as Parameters<typeof mergePersistedStoreState>[1]),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const repaired = rehydrateStoreState(state as StoreState);
        if (repaired && state.chats) {
          state.setChats(state.chats.slice());
        }
      },
      migrate: migratePersistedState,
    }
  )
);

export default useStore;
