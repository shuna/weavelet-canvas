import { withSyncProgress, syncStage } from './google/progress';
import type { PersistStorage } from 'zustand/middleware';
import { createJSONStorage } from 'zustand/middleware';
import useCloudAuthStore from '@store/cloud-auth-store';
import useStore from '@store/store';
import { createLocalStoragePartializedState, createPartializedState, prepareHydratedState, finishHydratedState, migratePersistedState, type PersistedStoreState } from '@store/persistence';
import { hasActiveStreamingBuffers } from '@utils/streamingBuffer';
import { isGoogleAuthError } from '@api/google-api';
import { showToast } from '@utils/showToast';
import compressedStorage from './CompressedStorage';
import { saveChatData } from './IndexedDbStorage';
import { EncryptedDriveSync } from './google/sync';
import { DriveTransport } from './google/transport';
import type { Snapshot } from './google/records';
import { sameSnapshotAsync as sameSnapshot } from './google/processing';
import { SyncConflictError, useSyncReview, markSyncChanges, type Resolution } from './google/conflicts';
import { STORE_VERSION } from '@store/version';

let session: EncryptedDriveSync | undefined;
let pending: { value: Snapshot; session: EncryptedDriveSync } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;
let suspended = true;
let applyingRemote = false;
let keyGeneration = 0;
let restoring: { id: string; promise: Promise<boolean> } | undefined;
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
  keyGeneration++;
  useSyncReview.setState({ conflict: false, cloudOverview: null, cloudReview: null });
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
export async function restoreGoogleSync(id: string): Promise<boolean> {
  if (isGoogleSyncUnlocked(id)) return true;
  if (restoring?.id === id) return restoring.promise;
  const generation = keyGeneration;
  const promise = (async () => {
    const next = new EncryptedDriveSync(id, transport());
    if (!await next.restoreKey() || generation !== keyGeneration) return false;
    lockGoogleSync();
    session = next;
    return true;
  })();
  restoring = { id, promise };
  try { return await promise; }
  finally { if (restoring?.promise === promise) restoring = undefined; }
}
const currentSnapshot = (): Snapshot => ({ state: createPartializedState(useStore.getState()), version: STORE_VERSION });
async function applySyncedSnapshot(target: EncryptedDriveSync, before: Snapshot, received: Snapshot) {
  const observed = useStore.getState();
  if (target !== session || !await sameSnapshot(before, currentSnapshot()) || observed !== useStore.getState()) return false;
  const state = useStore.getState();
  const selectedId = state.chats?.[state.currentChatIndex]?.id;
  const prepared = await prepareHydratedState(state,
    migratePersistedState(received.state, received.version ?? STORE_VERSION) as Partial<PersistedStoreState>);
  if (target !== session || state !== useStore.getState()) return false;
  const hydrated = finishHydratedState(prepared);
  if (selectedId && hydrated.chats) {
    const index = hydrated.chats.findIndex(chat => chat.id === selectedId);
    if (index >= 0) hydrated.currentChatIndex = index;
  }
  applyingRemote = true;
  try {
    useStore.setState(hydrated);
    await persistChatSnapshot(currentSnapshot());
    await target.acceptLocal(received);
    await markSyncChanges(before, received);
    if (!await sameSnapshot(received, currentSnapshot())) pending = { session: target, value: currentSnapshot() };
  } finally { applyingRemote = false; }
  return true;
}
async function synchronize(target: EncryptedDriveSync, snapshot: Snapshot) {
  const received = await syncStage(0, 2, () => target.synchronize(snapshot));
  await syncStage(1, 2, async () => {
    if (await sameSnapshot(snapshot, received)) return;
    if (!await applySyncedSnapshot(target, snapshot, received) && target === session) {
      pending = { session: target, value: currentSnapshot() };
    }
  });
}
export async function resumeGoogleSync() {
  lastQueuedState = undefined;
  useStore.persist.setOptions({ storage: createGoogleCloudStorage(), partialize: state => createPartializedState(state) });
  await queueGoogleSyncSnapshot(currentSnapshot());
  await flushPendingCloudSync();
}
export async function resolveGoogleSyncConflict(mode: Resolution) {
  await pauseGoogleSync();
  const target = session;
  if (!target) throw new Error('Unlock Google sync first.');
  const before = structuredClone(currentSnapshot());
  const resolved = await syncStage(0, 3, () => target.resolve(before, mode));
  if (!await syncStage(1, 3, () => applySyncedSnapshot(target, before, resolved))) {
    throw new Error('Local data changed during conflict resolution. Review the latest changes before retrying.');
  }
  useSyncReview.setState({ conflict: false });
  await syncStage(2, 3, () => resumeGoogleSync());
}

async function persistChatSnapshot(snapshot: Snapshot) {
  if (snapshot.state.chats) await saveChatData({
    chats: snapshot.state.chats, contentStore: snapshot.state.contentStore ?? {},
    branchClipboard: snapshot.state.branchClipboard ?? null,
  });
}
export async function createEncryptedGoogleSync(passphrase: string, snapshot: Snapshot, folderName?: string) {
  snapshot = structuredClone(snapshot);
  lockGoogleSync();
  await persistChatSnapshot(snapshot);
  const created = await syncStage(0, 2, () => EncryptedDriveSync.create(transport(), passphrase, { folderName }));
  session = created.session;
  await syncStage(1, 2, () => created.session.push(snapshot, true));
  return created.file;
}
export async function pullEncryptedGoogleSync(): Promise<Snapshot> {
  if (!session) throw new Error('Unlock Google sync first.');
  return session.pull();
}
export async function getGoogleSyncCloudOverview() {
  const target = session;
  if (!target) throw new Error('Unlock Google sync first.');
  const overview = await target.overview();
  if (target !== session) throw new Error('Google sync target changed.');
  return overview;
}
export async function getGoogleSyncCloudReview() {
  const target = session;
  if (!target) throw new Error('Unlock Google sync first.');
  const review = await target.inspect();
  if (target !== session) throw new Error('Google sync target changed.');
  return review;
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

async function runManualDriveOperation(work: () => Promise<void>) {
  while (inFlight) await inFlight;
  const operation = withSyncProgress(work);
  inFlight = operation;
  try { await operation; }
  finally {
    if (inFlight === operation) inFlight = undefined;
    if (pending && !suspended) schedule();
  }
}

export async function compactGoogleSyncHistory() {
  const target = session;
  if (!target) throw new Error('Unlock Google sync first.');
  await runManualDriveOperation(() => target.compactHistory());
}

// A separate session never applies imported data or changes the active sync target.
export async function importGoogleSyncSnapshot(id: string, passphrase: string, snapshot: Snapshot) {
  await runManualDriveOperation(async () => {
    const current = session?.dataset === id ? session : undefined;
    const target = current ?? new EncryptedDriveSync(id, transport());
    try {
      if (!current && !await target.restoreKey()) await target.unlock(passphrase);
      await target.importSnapshot(snapshot);
    } finally { if (!current) target.close(); }
  });
}

const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(flushAndReport, 5000);
};
const reportFailure = (error: unknown) => {
  const auth = useCloudAuthStore.getState();
  if (auth.provider !== 'google' || !auth.cloudSync) return;
  if (error instanceof SyncConflictError) useSyncReview.setState({ conflict: true, conflictKeys: error.keys, cloudOverview: null, cloudReview: null });
  auth.setSyncStatus(isGoogleAuthError(error) ? 'unauthenticated' : 'error');
  if (!(error instanceof SyncConflictError)) showToast(error instanceof Error ? error.message : String(error), 'error');
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
      // Freeze only the snapshot that will actually be sent, before yielding.
      next.value = structuredClone(next.value);
      auth.setSyncStatus('syncing');
      await synchronize(next.session, next.value);
      useSyncReview.setState({ conflict: false });
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
    if (applyingRemote || suspended || !session || session.dataset !== auth.fileId || auth.provider !== 'google' || !auth.cloudSync || !auth.syncTargetConfirmed) return;
    if (value.state === lastQueuedState) return;
    lastQueuedState = value.state;
    pending = { session, value: value as Snapshot };
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
