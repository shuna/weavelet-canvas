import type { PersistedStoreState } from '@store/persistence';

// These preferences stay in the existing browser storage, including while Drive sync is active.
export const BROWSER_LOCAL_SETTINGS = [
  'hideMenuOptions', 'hideSideMenu', 'menuWidth',
  'splitPanelRatio', 'splitPanelSwapped', 'chatActiveView', 'showDebugPanel',
  'proxyEnabled',
] as const satisfies readonly (keyof PersistedStoreState)[];

export const SYNC_LOCAL_SETTINGS = [
  ...BROWSER_LOCAL_SETTINGS,
  'pendingVerifications', 'verifiedStats', 'providerModelCache', 'totalTokenUsed',
  'theme', 'advancedMode', 'enterToSubmit', 'inlineLatex', 'markdownMode',
  'streamingMarkdownPolicy', 'displayChatSize', 'animateBubbleNavigation', 'branchSwipeDirection',
] as const satisfies readonly (keyof PersistedStoreState)[];

export function withoutBrowserLocalSettings(state: Partial<PersistedStoreState>) {
  const shared = { ...state };
  for (const key of SYNC_LOCAL_SETTINGS) delete shared[key];
  return shared;
}

export function isBrowserLocalRecord(key: string): boolean {
  let path: unknown;
  try { path = JSON.parse(key); } catch { return false; }
  if (!Array.isArray(path) || path[0] !== 'state') return false;
  const field = path[1];
  return SYNC_LOCAL_SETTINGS.some(key => key === field);
}

export function isNonBlockingRecord(key: string): boolean {
  if (isBrowserLocalRecord(key)) return true;
  let path: unknown;
  try { path = JSON.parse(key); } catch { return false; }
  if (!Array.isArray(path)) return false;
  return (path.length === 4 && path[0] === 'state' && path[1] === 'folders' && path[3] === 'expanded') ||
    (path.length >= 3 && path.length <= 4 && path[0] === 'chats' && path[2] === 'collapsedNodes') ||
    (path.length === 4 && path[0] === 'chats' && path[2] === 'branchTree' && path[3] === 'activePath');
}

export function selectActivePath(key: string, values: (string | null)[], records: Record<string, string>): string | null | undefined {
  if (!key.endsWith(',"activePath"]')) return;
  const path: string[] = JSON.parse(key);
  if (path.length !== 4 || path[0] !== 'chats' || path[2] !== 'branchTree' || path[3] !== 'activePath') return;
  if (records[JSON.stringify(['chats', path[1], 'id'])] === undefined) return null;
  const prefix = ['chats', path[1], 'branchTree'];
  const candidates = values.filter((value): value is string => value !== null).map(value => JSON.parse(value))
    .filter((value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string'));
  if (!candidates.length) return;
  const validPrefix = (ids: string[]) => {
    let length = 0;
    for (const id of ids) {
      if (records[JSON.stringify([...prefix, 'nodes', id, 'id'])] !== JSON.stringify(id) ||
        records[JSON.stringify([...prefix, 'nodes', id, 'parentId'])] !== JSON.stringify(length ? ids[length - 1] : null)) break;
      length++;
    }
    return ids.slice(0, length);
  };
  for (const candidate of candidates) if (validPrefix(candidate).length === candidate.length) return JSON.stringify(candidate);
  const retained = candidates.map(validPrefix).sort((a, b) => b.length - a.length)[0];
  const root = records[JSON.stringify([...prefix, 'rootId'])];
  return JSON.stringify(retained.length ? retained : root ? validPrefix([JSON.parse(root)]) : []);
}
