import { withSyncProgress } from './google/progress';
import type { PersistStorage } from 'zustand/middleware';
import { createJSONStorage } from 'zustand/middleware';
import useCloudAuthStore from '@store/cloud-auth-store';
import useStore from '@store/store';
import { createLocalStoragePartializedState } from '@store/persistence';
import { hasActiveStreamingBuffers } from '@utils/streamingBuffer';
import { isGoogleAuthError } from '@api/google-api';
import { showToast } from '@utils/showToast';
import compressedStorage from './CompressedStorage';
import { saveChatData } from './IndexedDbStorage';
import { EncryptedDriveSync } from './google/sync';
import { DriveTransport } from './google/transport';
import type { Snapshot } from './google/records';

let session: EncryptedDriveSync | undefined;
let pending: { value: Snapshot; session: EncryptedDriveSync } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;
let suspended = true;
let lastQueuedState: unknown;
const local = createJSONStorage(() => compressedStorage)!;

const transport = () => new DriveTransport(() => {
  const state = useCloudAuthStore.getState();
  if (state.provider !== 'google' || !state.googleAccessToken) throw new Error('Google sync is disconnected.');
  return state.googleAccessToken;
});
export async function pauseGoogleSync() {
  suspended = true;
  clearTimeout(timer); timer = undefined; pending = undefined;
  if (inFlight) await inFlight;
}
export const isGoogleSyncUnlocked = (id?: string) => !!session && session.dataset === id;
export function lockGoogleSync() {
  suspended = true;
  lastQueuedState = undefined;
  session?.close(); session = undefined; pending = undefined;
  clearTimeout(timer); timer = undefined;
}
export async function unlockGoogleSync(id: string, passphrase: string) {
  if (isGoogleSyncUnlocked(id)) return;
  lockGoogleSync();
  const next = new EncryptedDriveSync(id, transport());
  await next.unlock(passphrase);
  session = next;
}
async function persistChatSnapshot(snapshot: Snapshot) {
  if (snapshot.state.chats) await saveChatData({
    chats: snapshot.state.chats, contentStore: snapshot.state.contentStore ?? {},
    branchClipboard: snapshot.state.branchClipboard ?? null,
  });
}
export async function createEncryptedGoogleSync(passphrase: string, snapshot: Snapshot) {
  snapshot = structuredClone(snapshot);
  lockGoogleSync();
  await persistChatSnapshot(snapshot);
  const created = await EncryptedDriveSync.create(transport(), passphrase);
  session = created.session;
  await session.push(snapshot, true);
  return created.file;
}
export async function pullEncryptedGoogleSync(): Promise<Snapshot> {
  if (!session) throw new Error('Unlock Google sync first.');
  return session.pull();
}
export async function acceptGoogleSyncLocal(snapshot: Snapshot) {
  if (!session) throw new Error('Unlock Google sync first.');
  await session.acceptLocal(snapshot);
}
export async function pushEncryptedGoogleSync(snapshot: Snapshot, replace = false) {
  if (!session) throw new Error('Unlock Google sync first.');
  await persistChatSnapshot(snapshot);
  await session.push(snapshot, replace);
}

const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(flushAndReport, 5000);
};
const reportFailure = (error: unknown) => {
  const auth = useCloudAuthStore.getState();
  if (auth.provider !== 'google' || !auth.cloudSync) return;
  auth.setSyncStatus(isGoogleAuthError(error) ? 'unauthenticated' : 'error');
  showToast(error instanceof Error ? error.message : String(error), 'error');
};
function flushAndReport() {
  const target = session;
  void flushPendingCloudSync().catch((error) => {
    if (session === target) reportFailure(error);
  });
}
export async function flushPendingCloudSync(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  if (inFlight) {
    await inFlight;
    if (pending) await flushPendingCloudSync();
    return;
  }
  if (!pending || suspended) return;
  if (hasActiveStreamingBuffers()) { schedule(); return; }
  const next = pending;
  const auth = useCloudAuthStore.getState();
  if (next.session !== session || auth.provider !== 'google' || !auth.cloudSync ||
      !auth.syncTargetConfirmed || auth.fileId !== next.session.dataset) return;
  pending = undefined;
  inFlight = withSyncProgress(async () => {
    try {
      auth.setSyncStatus('syncing');
      await persistChatSnapshot(next.value);
      await next.session.push(next.value);
      if (session === next.session) auth.setSyncStatus('synced');
    } catch (error) {
      if (session === next.session) pending ??= next;
      throw error;
    }
  });
  try { await inFlight; }
  finally { inFlight = undefined; }
  if (pending) schedule();
}

// Keep local persistence active even when Drive is locked, offline or waiting for retries.
const storage: PersistStorage<unknown> = {
  getItem: (name) => local.getItem(name),
  setItem: async (name, value) => {
    await local.setItem(name, { ...value, state: createLocalStoragePartializedState(useStore.getState()) });
    const auth = useCloudAuthStore.getState();
    if (suspended || !session || session.dataset !== auth.fileId || auth.provider !== 'google' || !auth.cloudSync || !auth.syncTargetConfirmed) return;
    if (value.state === lastQueuedState) return;
    lastQueuedState = value.state;
    pending = { session, value: structuredClone(value) as Snapshot };
    // Failed uploads remain queued; an explicit resume retries them instead of a toast loop on every UI update.
    if (auth.syncStatus !== 'error' && auth.syncStatus !== 'unauthenticated') schedule();
  },
  removeItem: (name) => local.removeItem(name),
};

if (typeof window !== 'undefined') {
  const flush = flushAndReport;
  window.addEventListener('online', flush);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

// Queue edits made while an initial/manual upload was in progress using the normal debounce/outbox path.
export async function queueGoogleSyncSnapshot(snapshot: Snapshot) {
  await storage.setItem(useStore.persist.getOptions().name!, snapshot);
}

export const resetPendingCloudSyncForTests = lockGoogleSync;
export default function createGoogleCloudStorage<S>(): PersistStorage<S> {
  suspended = false;
  return storage as PersistStorage<S>;
}
