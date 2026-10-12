import { rehydrateData } from './rehydrateData';
import { prepareHydratedDataAsync } from './storage/google/processing';
import { ContentStoreData } from '@utils/contentStore';
import {
  finalizeStreamingSnapshotState,
  hasActiveStreamingBuffers,
  isStreamingContentHash,
} from '@utils/streamingBuffer';
import { captureProjectedMessageAttributes } from '@utils/branchUtils';
import { addContent } from '@utils/contentStore';
import { getBufferedContent } from '@utils/streamingBuffer';
import { BranchClipboard, ChatInterface } from '@type/chat';
import type { StoreState } from './store';
import type { StoreApi } from 'zustand';
import { setLocalStorageItem } from './storage/storageErrors';
import { STORE_VERSION } from './version';

type PersistedChat = Omit<ChatInterface, 'messages'> & {
  messages?: ChatInterface['messages'];
};

export type PersistedStoreState = Omit<
  Pick<
  StoreState,
  | 'chats'
  | 'apiKey'
  | 'apiVersion'
  | 'apiEndpoint'
  | 'theme'
  | 'autoTitle'
  | 'titleModel'
  | 'titleProviderId'
  | 'advancedMode'
  | 'prompts'
  | 'defaultChatConfig'
  | 'defaultSystemMessage'
  | 'hideMenuOptions'
| 'hideSideMenu'
  | 'folders'
  | 'enterToSubmit'
  | 'inlineLatex'
  | 'markdownMode'
  | 'streamingMarkdownPolicy'
  | 'totalTokenUsed'
  | 'countTotalTokens'
  | 'displayChatSize'
  | 'menuWidth'
  | 'defaultImageDetail'
  | 'animateBubbleNavigation'
  | 'providers'
  | 'favoriteModels'
  | 'branchClipboard'
  | 'contentStore'
  | 'providerModelCache'
  | 'providerCustomModels'
  | '_legacyCustomModels'
  | 'onboardingCompleted'
  | 'splitPanelRatio'
  | 'splitPanelSwapped'
  | 'chatActiveView'
  | 'proxyEnabled'
  | 'proxyEndpoint'
  | 'proxyAuthToken'
  | 'showDebugPanel'
  | 'searchHistory'
  | 'sidebarSearchHistory'
  | 'chatFindHistory'
  | 'verifiedStats'
  | 'pendingVerifications'
  | 'evaluationSettings'
  | 'safetyThresholds'
  | 'qualityThresholds'
  | 'evaluationResults'
  | 'localModelEnabled'
  | 'localModels'
  | 'favoriteLocalModelIds'
  | 'localModelExecutionMode'
  | 'activeLocalModels'
  | 'savedModelMeta'
  >,
  'chats'
> & {
  chats?: PersistedChat[];
};

export type PersistedChatData = Pick<
  PersistedStoreState,
  'chats' | 'contentStore' | 'branchClipboard'
>;

type LocalStoragePersistedState = Omit<
  PersistedStoreState,
  'chats' | 'contentStore' | 'branchClipboard'
>;

const FULL_PERSIST_KEYS: (keyof PersistedStoreState)[] = [
  'chats', 'apiKey', 'apiVersion', 'apiEndpoint', 'theme', 'autoTitle',
  'titleModel', 'titleProviderId', 'advancedMode', 'prompts', 'defaultChatConfig', 'defaultSystemMessage',
  'hideMenuOptions', 'hideSideMenu', 'folders', 'enterToSubmit',
  'inlineLatex', 'markdownMode', 'streamingMarkdownPolicy', 'totalTokenUsed', 'countTotalTokens',
  'displayChatSize', 'menuWidth', 'defaultImageDetail', 'animateBubbleNavigation',
  'providers', 'favoriteModels',
  'branchClipboard', 'contentStore', 'providerModelCache',
  'providerCustomModels', '_legacyCustomModels',
  'onboardingCompleted',
  'splitPanelRatio', 'splitPanelSwapped', 'chatActiveView',
  'proxyEnabled', 'proxyEndpoint', 'proxyAuthToken',
  'showDebugPanel',
  'searchHistory',
  'sidebarSearchHistory',
  'chatFindHistory',
  'verifiedStats',
  'pendingVerifications',
  'evaluationSettings',
  'safetyThresholds',
  'qualityThresholds',
  'evaluationResults',
  'localModelEnabled',
  'localModels',
  'favoriteLocalModelIds',
  'localModelExecutionMode',
  'activeLocalModels',
  'savedModelMeta',
];

const LOCAL_STORAGE_PERSIST_KEYS: (keyof LocalStoragePersistedState)[] = [
  'apiKey', 'apiVersion', 'apiEndpoint', 'theme', 'autoTitle',
  'titleModel', 'titleProviderId', 'advancedMode', 'prompts', 'defaultChatConfig', 'defaultSystemMessage',
  'hideMenuOptions', 'hideSideMenu', 'folders', 'enterToSubmit',
  'inlineLatex', 'markdownMode', 'streamingMarkdownPolicy', 'totalTokenUsed', 'countTotalTokens',
  'displayChatSize', 'menuWidth', 'defaultImageDetail', 'animateBubbleNavigation',
  'providers', 'favoriteModels',
  'providerModelCache',
  'providerCustomModels', '_legacyCustomModels',
  'onboardingCompleted',
  'splitPanelRatio', 'splitPanelSwapped', 'chatActiveView',
  'proxyEnabled', 'proxyEndpoint', 'proxyAuthToken',
  'showDebugPanel',
  'searchHistory',
  'sidebarSearchHistory',
  'chatFindHistory',
  'verifiedStats',
  'pendingVerifications',
  'evaluationSettings',
  'safetyThresholds',
  'qualityThresholds',
  'evaluationResults',
  'localModelEnabled',
  'localModels',
  'favoriteLocalModelIds',
  'localModelExecutionMode',
  'activeLocalModels',
  'savedModelMeta',
];

const persistedKeys = new Set<string>(FULL_PERSIST_KEYS);
// Only persisted input can populate this sidecar; runtime fields stay out of snapshots.
const unknownRoots = Symbol('unknown persisted roots');
const emptyUnknownRoots: Record<string, unknown> = {};
type StateWithUnknownRoots = StoreState & { [unknownRoots]?: Record<string, unknown> };
const getUnknownRoots = (state: StoreState) => (state as StateWithUnknownRoots)[unknownRoots] ?? emptyUnknownRoots;
const knownPersistedFields = (persisted: Partial<PersistedStoreState>) =>
  Object.fromEntries(Object.entries(persisted).filter(([key]) => persistedKeys.has(key))) as Partial<PersistedStoreState>;

export function mergePersistedStoreState(base: StoreState, persisted: Partial<PersistedStoreState>): StoreState {
  if (persisted === undefined) return base; // Zustand calls merge with no stored snapshot on first launch.
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) throw new Error('Invalid persisted state.');
  const unknown = Object.fromEntries(Object.entries(persisted).filter(([key]) => !persistedKeys.has(key)));
  return {
    ...base, ...knownPersistedFields(persisted),
    [unknownRoots]: { ...getUnknownRoots(base), ...structuredClone(unknown) },
  } as StoreState;
}

export function preservePersistedRootsOnReplace(set: StoreApi<StoreState>['setState']): StoreApi<StoreState>['setState'] {
  return (partial, replace) => {
    if (replace) {
      set(state => {
        const next = typeof partial === 'function' ? partial(state) : partial;
        return { ...next, [unknownRoots]: (next as StateWithUnknownRoots)[unknownRoots] ?? getUnknownRoots(state) } as StoreState;
      }, true);
    } else set(partial, false);
  };
}

let previousFullInputRefs: Partial<Record<keyof PersistedStoreState, unknown>> = {};
let previousFullResult: PersistedStoreState | null = null;
let previousFullUnknownRoots = emptyUnknownRoots;

let previousLocalInputRefs: Partial<Record<keyof LocalStoragePersistedState, unknown>> = {};
let previousLocalResult: LocalStoragePersistedState | null = null;
let previousLocalUnknownRoots = emptyUnknownRoots;

/**
 * When true, localStorage persist will strip chats/contentStore/branchClipboard
 * (normal operation — data lives in IndexedDB).
 * When false (during bootstrap), localStorage retains these fields as a safety net
 * so that data is not lost if IndexedDB write fails or the page crashes mid-migration.
 */
let indexedDbMigrationComplete = false;

export function setIndexedDbMigrationComplete(v: boolean): void {
  indexedDbMigrationComplete = v;
  // Invalidate cache so next persist picks up the change
  previousLocalResult = null;
}

const getMapKey = (chatIndex: number) => String(chatIndex);

const buildPersistedChats = (state: StoreState): PersistedChat[] | undefined =>
  state.chats?.map(({ messages, ...rest }, index) => {
    const mapKey = getMapKey(index);
    // Sync runtime node maps back into the chat object for persistence.
    // The toggle functions only update the runtime maps (collapsedNodeMaps,
    // omittedNodeMaps, protectedNodeMaps) without writing back to the
    // ChatInterface fields, so we merge them here before saving.
    const collapsedNodes = state.collapsedNodeMaps?.[mapKey] ?? rest.collapsedNodes;
    const omittedNodes = state.omittedNodeMaps?.[mapKey] ?? rest.omittedNodes;
    const protectedNodes = state.protectedNodeMaps?.[mapKey] ?? rest.protectedNodes;
    const merged = {
      ...rest,
      collapsedNodes,
      omittedNodes,
      protectedNodes,
    };
    if (merged.branchTree) {
      const chat = { ...merged, messages };
      captureProjectedMessageAttributes(chat, state.contentStore);
      const { messages: _projection, ...persisted } = chat;
      return persisted;
    }
    return { ...merged, messages };
  });


function sanitizeClipboard(
  clipboard: BranchClipboard | null,
  contentStore: ContentStoreData
): BranchClipboard | null {
  if (!clipboard) return null;
  const streamingNodes = Object.values(clipboard.nodes).filter((n) =>
    isStreamingContentHash(n.contentHash)
  );
  if (streamingNodes.length === 0) return clipboard;
  const updatedNodes = { ...clipboard.nodes };
  for (const node of streamingNodes) {
    const nodeId = node.id;
    const content = getBufferedContent(nodeId) ?? [];
    updatedNodes[nodeId] = {
      ...updatedNodes[nodeId],
      contentHash: addContent(contentStore, content),
    };
  }
  return { ...clipboard, nodes: updatedNodes };
}

function buildPartializedState(state: StoreState): PersistedStoreState {
  const snapshot = finalizeStreamingSnapshotState(state.chats, state.contentStore);
  return {
    ...getUnknownRoots(state),
    chats: buildPersistedChats({
      ...state,
      chats: snapshot.chats,
    } as StoreState),
    apiKey: state.apiKey,
    apiVersion: state.apiVersion,
    apiEndpoint: state.apiEndpoint,
    theme: state.theme,
    autoTitle: state.autoTitle,
    titleModel: state.titleModel,
    titleProviderId: state.titleProviderId,
    advancedMode: state.advancedMode,
    prompts: state.prompts,
    defaultChatConfig: state.defaultChatConfig,
    defaultSystemMessage: state.defaultSystemMessage,
    hideMenuOptions: state.hideMenuOptions,
    hideSideMenu: state.hideSideMenu,
    folders: state.folders,
    enterToSubmit: state.enterToSubmit,
    inlineLatex: state.inlineLatex,
    markdownMode: state.markdownMode,
    streamingMarkdownPolicy: state.streamingMarkdownPolicy,
    totalTokenUsed: state.totalTokenUsed,
    countTotalTokens: state.countTotalTokens,
    displayChatSize: state.displayChatSize,
    menuWidth: state.menuWidth,
    defaultImageDetail: state.defaultImageDetail,
    animateBubbleNavigation: state.animateBubbleNavigation,

    providers: state.providers,
    favoriteModels: state.favoriteModels,
    branchClipboard: sanitizeClipboard(state.branchClipboard, snapshot.contentStore),
    contentStore: snapshot.contentStore,
    providerModelCache: state.providerModelCache,
    providerCustomModels: state.providerCustomModels,
    _legacyCustomModels: state._legacyCustomModels,
    onboardingCompleted: state.onboardingCompleted,
    splitPanelRatio: state.splitPanelRatio,
    splitPanelSwapped: state.splitPanelSwapped,
    chatActiveView: state.chatActiveView,
    proxyEnabled: state.proxyEnabled,
    proxyEndpoint: state.proxyEndpoint,
    proxyAuthToken: state.proxyAuthToken,
    showDebugPanel: state.showDebugPanel,
    searchHistory: state.searchHistory,
    sidebarSearchHistory: state.sidebarSearchHistory,
    chatFindHistory: state.chatFindHistory,
    verifiedStats: state.verifiedStats,
    pendingVerifications: state.pendingVerifications,
    evaluationSettings: state.evaluationSettings,
    safetyThresholds: state.safetyThresholds,
    qualityThresholds: state.qualityThresholds,
    evaluationResults: state.evaluationResults,
    localModelEnabled: state.localModelEnabled,
    localModels: state.localModels,
    favoriteLocalModelIds: state.favoriteLocalModelIds,
    localModelExecutionMode: state.localModelExecutionMode,
    activeLocalModels: state.activeLocalModels,
    savedModelMeta: state.savedModelMeta,
  };
}

function buildLocalStoragePartializedState(
  state: StoreState
): LocalStoragePersistedState {
  return {
    ...getUnknownRoots(state),
    apiKey: state.apiKey,
    apiVersion: state.apiVersion,
    apiEndpoint: state.apiEndpoint,
    theme: state.theme,
    autoTitle: state.autoTitle,
    titleModel: state.titleModel,
    titleProviderId: state.titleProviderId,
    advancedMode: state.advancedMode,
    prompts: state.prompts,
    defaultChatConfig: state.defaultChatConfig,
    defaultSystemMessage: state.defaultSystemMessage,
    hideMenuOptions: state.hideMenuOptions,
    hideSideMenu: state.hideSideMenu,
    folders: state.folders,
    enterToSubmit: state.enterToSubmit,
    inlineLatex: state.inlineLatex,
    markdownMode: state.markdownMode,
    streamingMarkdownPolicy: state.streamingMarkdownPolicy,
    totalTokenUsed: state.totalTokenUsed,
    countTotalTokens: state.countTotalTokens,
    displayChatSize: state.displayChatSize,
    menuWidth: state.menuWidth,
    defaultImageDetail: state.defaultImageDetail,
    animateBubbleNavigation: state.animateBubbleNavigation,

    providers: state.providers,
    favoriteModels: state.favoriteModels,
    providerModelCache: state.providerModelCache,
    providerCustomModels: state.providerCustomModels,
    _legacyCustomModels: state._legacyCustomModels,
    onboardingCompleted: state.onboardingCompleted,
    splitPanelRatio: state.splitPanelRatio,
    splitPanelSwapped: state.splitPanelSwapped,
    chatActiveView: state.chatActiveView,
    proxyEnabled: state.proxyEnabled,
    proxyEndpoint: state.proxyEndpoint,
    proxyAuthToken: state.proxyAuthToken,
    showDebugPanel: state.showDebugPanel,
    searchHistory: state.searchHistory,
    sidebarSearchHistory: state.sidebarSearchHistory,
    chatFindHistory: state.chatFindHistory,
    verifiedStats: state.verifiedStats,
    pendingVerifications: state.pendingVerifications,
    evaluationSettings: state.evaluationSettings,
    safetyThresholds: state.safetyThresholds,
    qualityThresholds: state.qualityThresholds,
    evaluationResults: state.evaluationResults,
    localModelEnabled: state.localModelEnabled,
    localModels: state.localModels,
    favoriteLocalModelIds: state.favoriteLocalModelIds,
    localModelExecutionMode: state.localModelExecutionMode,
    activeLocalModels: state.activeLocalModels,
    savedModelMeta: state.savedModelMeta,
  };
}

export const createPartializedState = (state: StoreState): PersistedStoreState => {
  let changed = !previousFullResult || hasActiveStreamingBuffers() || getUnknownRoots(state) !== previousFullUnknownRoots;

  if (!changed) {
    for (const key of FULL_PERSIST_KEYS) {
      if (state[key] !== previousFullInputRefs[key]) {
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    previousFullResult = buildPartializedState(state);
    const refs: Partial<Record<keyof PersistedStoreState, unknown>> = {};
    for (const key of FULL_PERSIST_KEYS) {
      refs[key] = state[key];
    }
    previousFullInputRefs = refs;
    previousFullUnknownRoots = getUnknownRoots(state);
  }

  return previousFullResult!;
};

export const createLocalStoragePartializedState = (
  state: StoreState
): LocalStoragePersistedState | PersistedStoreState => {
  // Before IndexedDB migration is confirmed, keep chats/contentStore in localStorage
  // as a safety net against data loss from crashes or storage eviction.
  if (!indexedDbMigrationComplete) {
    const hasChats = state.chats && state.chats.length > 0;
    const hasContentStore = Object.keys(state.contentStore ?? {}).length > 0;
    if (hasChats || hasContentStore || state.branchClipboard) {
      return createPartializedState(state);
    }
  }

  let changed = !previousLocalResult || getUnknownRoots(state) !== previousLocalUnknownRoots;

  if (!changed) {
    for (const key of LOCAL_STORAGE_PERSIST_KEYS) {
      if (state[key] !== previousLocalInputRefs[key]) {
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    previousLocalResult = buildLocalStoragePartializedState(state);
    const refs: Partial<Record<keyof LocalStoragePersistedState, unknown>> = {};
    for (const key of LOCAL_STORAGE_PERSIST_KEYS) {
      refs[key] = state[key];
    }
    previousLocalInputRefs = refs;
    previousLocalUnknownRoots = getUnknownRoots(state);
  }

  return previousLocalResult!;
};

function reportRepairedChats(repairedChatTitles: string[]) {
  if (repairedChatTitles.length > 0) {
    setTimeout(() => {
      import('@utils/showToast').then(({ showToast }) => {
        showToast(
          `${repairedChatTitles.length}件のチャットデータを修復しました: ${repairedChatTitles.join(', ')}`,
          'warning'
        );
      });
    }, 0);
  }

}
export const rehydrateStoreState = (state: StoreState) => {
  const { repaired, repairedChatTitles } = rehydrateData(state, parseInt(localStorage.getItem('currentChatIndex') ?? '-1', 10));
  reportRepairedChats(repairedChatTitles);
  createPartializedState(state);
  return repaired;
};

export function prepareHydratedState(base: StoreState, persisted: Partial<PersistedStoreState>) {
  const merged = mergePersistedStoreState(base, persisted);
  const known = knownPersistedFields(persisted);
  const { chats, contentStore, branchClipboard, providers, evaluationSettings, verifiedStats, pendingVerifications } = base;
  return prepareHydratedDataAsync({
    base: Object.fromEntries(Object.entries({ chats, contentStore, branchClipboard, providers, evaluationSettings, verifiedStats, pendingVerifications })
      .filter(([key]) => !Object.hasOwn(known, key))),
    persisted: known, savedIndex: parseInt(localStorage.getItem('currentChatIndex') ?? '-1', 10),
  }).then(prepared => ({ ...prepared, state: { ...prepared.state, [unknownRoots]: getUnknownRoots(merged) } }));
}
export function finishHydratedState(prepared: Awaited<ReturnType<typeof prepareHydratedState>>) {
  reportRepairedChats(prepared.repairedChatTitles);
  setLocalStorageItem('currentChatIndex', String(prepared.state.currentChatIndex));
  return prepared.state;
}

export const createPersistedChatDataState = (
  state: StoreState
): PersistedChatData => {
  const snapshot = finalizeStreamingSnapshotState(state.chats, state.contentStore);
  return {
    chats: buildPersistedChats({
      ...state,
      chats: snapshot.chats,
    } as StoreState),
    contentStore: snapshot.contentStore,
    branchClipboard: sanitizeClipboard(state.branchClipboard, snapshot.contentStore),
  };
};

export const applyPersistedChatDataState = (
  state: StoreState,
  persistedChatData: PersistedChatData
) => {
  state.chats = persistedChatData.chats as ChatInterface[] | undefined;
  state.contentStore = persistedChatData.contentStore ?? {};
  state.branchClipboard = persistedChatData.branchClipboard ?? null;
  return rehydrateStoreState(state);
};

export const hydrateFromPersistedStoreState = (
  baseState: StoreState,
  persistedState: Partial<PersistedStoreState>
): Partial<StoreState> => {
  const hasChats = Object.prototype.hasOwnProperty.call(persistedState, 'chats');
  const hasContentStore = Object.prototype.hasOwnProperty.call(
    persistedState,
    'contentStore'
  );
  const hasBranchClipboard = Object.prototype.hasOwnProperty.call(
    persistedState,
    'branchClipboard'
  );
  const nextState = mergePersistedStoreState(baseState, persistedState);

  applyPersistedChatDataState(nextState, {
    chats: hasChats ? persistedState.chats : baseState.chats,
    contentStore: hasContentStore
      ? persistedState.contentStore ?? {}
      : baseState.contentStore,
    branchClipboard: hasBranchClipboard
      ? persistedState.branchClipboard ?? null
      : baseState.branchClipboard,
  });

  const currentChatIndex =
    nextState.chats && nextState.chats.length > 0 ? nextState.currentChatIndex : -1;
  setLocalStorageItem('currentChatIndex', String(currentChatIndex));

  return {
    ...knownPersistedFields(persistedState),
    [unknownRoots]: getUnknownRoots(nextState),
    chats: nextState.chats,
    contentStore: nextState.contentStore,
    branchClipboard: nextState.branchClipboard,
    currentChatIndex,
  } as Partial<StateWithUnknownRoots>;
};

/**
 * Flag set when persisted data was loaded from an older store version.
 * Bootstrap checks this to show an export/import prompt instead of
 * auto-migrating.
 */
let _needsDataMigration = false;

export function needsDataMigration(): boolean {
  return _needsDataMigration;
}

export function clearNeedsDataMigration(): void {
  _needsDataMigration = false;
}

/**
 * Called by zustand persist middleware when the stored version differs
 * from STORE_VERSION.  Auto-migration has been removed — the persisted
 * state is returned as-is and a flag is raised so the UI can prompt the
 * user to export and re-import.
 */
export const migratePersistedState = (
  persistedState: unknown,
  version: number
) => {
  if (version < STORE_VERSION) {
    _needsDataMigration = true;
    console.warn(
      `[persistence] Persisted data version ${version} < ${STORE_VERSION}. ` +
      'Auto-migration removed. Please export and re-import your data.'
    );
  }
  return persistedState as StoreState;
};
