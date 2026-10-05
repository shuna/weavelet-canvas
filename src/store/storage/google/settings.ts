import type { PersistedStoreState } from '@store/persistence';

// These preferences stay in the existing browser storage, including while Drive sync is active.
export const BROWSER_LOCAL_SETTINGS = [
  'hideMenuOptions', 'hideSideMenu', 'menuWidth',
  'splitPanelRatio', 'splitPanelSwapped', 'chatActiveView', 'showDebugPanel',
  'proxyEnabled',
] as const satisfies readonly (keyof PersistedStoreState)[];

export function withoutBrowserLocalSettings(state: Partial<PersistedStoreState>) {
  const shared = { ...state };
  for (const key of BROWSER_LOCAL_SETTINGS) delete shared[key];
  return shared;
}
