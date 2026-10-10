import useStore from '@store/store';
import useCloudAuthStore from '@store/cloud-auth-store';
import { createPartializedState, prepareHydratedState, finishHydratedState, migratePersistedState, type PersistedStoreState } from '@store/persistence';
import { STORE_VERSION } from '@store/version';
import { hasActiveStreamingBuffers } from '@utils/streamingBuffer';
import { showToast } from '@utils/showToast';
import { saveChatData, areChatDataWritesBlocked } from './IndexedDbStorage';
import { EncryptedSync } from './sync/EncryptedSync';
import { FileSystemTransport } from './filesystem/transport';
import { savedFileSystemTarget, type FileSystemSyncTarget } from './filesystem/handleStore';
import { sameSnapshotAsync as sameSnapshot } from './google/processing';
import { markSyncChanges, SyncConflictError, useSyncReview, type Resolution } from './google/conflicts';
import type { Snapshot } from './google/records';

let target: FileSystemSyncTarget | undefined;
let session: EncryptedSync | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let applying = false;
let inFlight: Promise<void> | undefined;
let restoring: Promise<void> | undefined;
let manualOperation: Promise<void> | undefined;
let generation = 0;
const snapshot = (): Snapshot => ({ state: createPartializedState(useStore.getState()), version: STORE_VERSION });
const active = () => {
  const auth = useCloudAuthStore.getState();
  return auth.provider === 'filesystem' && auth.cloudSync && auth.syncTargetConfirmed;
};
const healthy = () => !areChatDataWritesBlocked() && useStore.getState().migrationUiState?.status !== 'storage-recovery-required';
const status = (value: 'syncing' | 'synced' | 'error' | 'locked' | 'unauthenticated') => {
  useCloudAuthStore.getState().setProviderSession('filesystem', { syncStatus: value });
};
function stop() {
  generation++;
  clearTimeout(timer); timer = undefined; pending = false;
  session?.close(); session = undefined;
}
function report(error: unknown) {
  useSyncReview.setState({ conflict: error instanceof SyncConflictError });
  status(error instanceof Error && error.name === 'NotAllowedError' ? 'unauthenticated' : 'error');
  showToast(error instanceof Error ? error.message : String(error), 'error');
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { void flushFileSystemSync().catch(() => {}); }, 1500);
}
async function persist(value: Snapshot) {
  if (value.state.chats) await saveChatData({ chats: value.state.chats, contentStore: value.state.contentStore ?? {}, branchClipboard: value.state.branchClipboard ?? null });
}
async function apply(received: Snapshot, before: Snapshot, current: EncryptedSync, revision: number) {
  const observed = useStore.getState();
  if (revision !== generation || current !== session || !await sameSnapshot(before, snapshot()) || observed !== useStore.getState()) return false;
  const prepared = await prepareHydratedState(observed,
    migratePersistedState(received.state, received.version ?? STORE_VERSION) as Partial<PersistedStoreState>);
  if (revision !== generation || current !== session || observed !== useStore.getState()) return false;
  const hydrated = finishHydratedState(prepared);
  const selectedId = observed.chats?.[observed.currentChatIndex]?.id;
  const index = hydrated.chats?.findIndex(chat => chat.id === selectedId) ?? -1;
  if (index >= 0) hydrated.currentChatIndex = index;
  await persist({ state: hydrated, version: STORE_VERSION });
  if (revision !== generation || current !== session || observed !== useStore.getState()) {
    await persist(snapshot());
    return false;
  }
  applying = true;
  try {
    useStore.setState(hydrated);
    await current.acceptLocal(received, target?.downloadPending === true);
    await markSyncChanges(before, received);
  } finally { applying = false; }
  return true;
}
export async function flushFileSystemSync() {
  clearTimeout(timer); timer = undefined;
  if (inFlight) { await inFlight; return; }
  if (!active() || !session || !target || !healthy()) return;
  if (hasActiveStreamingBuffers()) { pending = true; schedule(); return; }
  const current = session, saved = target, revision = generation;
  inFlight = (async () => {
    try {
      const before = structuredClone(snapshot());
      pending = false;
      status('syncing');
      const received = saved.downloadPending
        ? await current.pull(false)
        : await current.synchronize(before, saved.initialized ? false : 'if-empty');
      if (revision !== generation || current !== session) return;
      if (saved.downloadPending || !await sameSnapshot(before, received)) {
        if (!await apply(received, before, current, revision)) {
          if (saved.downloadPending) throw new Error('読み込み中にローカルデータが変更されました。再開して読み込みをやり直してください。');
          pending = true;
        }
      }
      if (revision !== generation || current !== session) return;
      if (!saved.initialized || saved.downloadPending) { await savedFileSystemTarget({ ...saved, initialized: true, downloadPending: false, headerId: undefined }); saved.initialized = true; saved.downloadPending = false; saved.headerId = undefined; }
      useSyncReview.setState({ conflict: false });
      status('synced');
    } catch (error) {
      if (revision === generation && current === session) { pending = true; report(error); }
      throw error;
    }
  })();
  try { await inFlight; }
  finally { inFlight = undefined; }
  if (pending && active() && useCloudAuthStore.getState().syncStatus === 'synced') schedule();
}
async function attach(saved: FileSystemSyncTarget, revision: number, password?: string) {
  const next = new EncryptedSync(saved.dataset, new FileSystemTransport(saved.handle));
  const remembered = await next.restoreKey();
  if (revision !== generation) { next.close(); return; }
  if (remembered && saved.headerId) await next.resumeCreation(saved.headerId);
  await new FileSystemTransport(saved.handle).keyHeader(saved.dataset);
  if (revision !== generation) { next.close(); return; }
  if (!remembered) {
    if (!password) { status('locked'); return; }
    await next.unlock(password);
  }
  if (revision !== generation) { next.close(); return; }
  session = next;
}
function activate(saved: FileSystemSyncTarget) {
  const auth = useCloudAuthStore.getState();
  auth.setProvider('filesystem');
  auth.setProviderSession('filesystem', { targetId: saved.dataset, targetLabel: saved.handle.name, syncTargetConfirmed: true, syncStatus: 'syncing' });
  auth.setCloudSync(true);
}
async function restore() {
  if (restoring) return restoring;
  const revision = generation;
  restoring = (async () => {
    const saved = await savedFileSystemTarget();
    if (revision !== generation || useCloudAuthStore.getState().provider !== 'filesystem') return;
    if (!active() && !saved?.headerId) return;
    target = saved;
    if (saved?.headerId && !active()) activate(saved);
    if (!saved || saved.dataset !== useCloudAuthStore.getState().remoteTargetId) { status('unauthenticated'); return; }
    if (await saved.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') { status('unauthenticated'); return; }
    if (revision !== generation || !active()) return;
    await attach(saved, revision);
    if (revision !== generation || !active()) return;
    if (session && saved.downloadPending) { status('error'); return; }
    if (session) await flushFileSystemSync();
  })();
  try { await restoring; }
  catch (error) { if (revision === generation && useCloudAuthStore.getState().provider === 'filesystem') report(error); }
  finally { restoring = undefined; }
}

function manually(work: () => Promise<void>): Promise<void> {
  if (manualOperation) return Promise.reject(new Error('現在の操作が終了するまでお待ちください。'));
  const promise = Promise.resolve().then(async () => {
    if (restoring) await restoring;
    if (inFlight) await inFlight;
    await work();
  });
  manualOperation = promise;
  return promise.finally(() => { if (manualOperation === promise) manualOperation = undefined; });
}
export function connectFileSystemSync(handle: FileSystemDirectoryHandle, password: string, create: boolean) {
  return manually(async () => {
  if (!healthy()) throw new Error('ローカルデータの復旧を完了してから接続してください。');
  if (inFlight) throw new Error('保存処理の終了を待ってください。');
  stop();
  const revision = generation;
  const transport = new FileSystemTransport(handle);
  let current: EncryptedSync;
  let dataset: string;
  if (create) {
    try {
      const created = await EncryptedSync.create(transport, password);
      current = created.session; dataset = created.file.id;
    } catch (error) {
      const incomplete = await savedFileSystemTarget();
      if (revision === generation && incomplete?.headerId && await incomplete.handle.isSameEntry(handle)) {
        target = incomplete;
        activate(incomplete);
      }
      throw error;
    }
  } else {
    const manifest = await transport.manifest();
    if (!manifest) throw new Error('選択したフォルダーに同期データがありません。');
    dataset = manifest.dataset;
    current = new EncryptedSync(dataset, transport);
    await current.unlock(password);
  }
  if (revision !== generation) { current.close(); return; }
  target = { handle, dataset, initialized: !create, downloadPending: !create };
  await savedFileSystemTarget(target);
  if (revision !== generation) { current.close(); return; }
  session = current;
  activate(target);
  await flushFileSystemSync();
  });
}
export async function reconnectFileSystemSync(password: string) {
  if (!target) throw new Error('保存先を選択し直してください。');
  // Request from the click handler before other asynchronous work consumes user activation.
  const revision = generation;
  const saved = target;
  const permission = saved.handle.requestPermission({ mode: 'readwrite' });
  return manually(async () => {
  if (await permission !== 'granted') { status('unauthenticated'); return; }
  if (revision !== generation || !active()) return;
  if (!healthy()) throw new Error('ローカルデータの復旧を完了してから再開してください。');
  await attach(saved, revision, password);
  if (session && revision === generation) await flushFileSystemSync();
  });
}
export function resolveFileSystemConflict(mode: Resolution) {
  return manually(async () => {
  if (!session || !healthy()) throw new Error('保存先への接続とローカルデータの復旧が必要です。');
  const current = session, revision = generation, before = structuredClone(snapshot());
  status('syncing');
  const received = await current.resolve(before, mode);
  if (!await apply(received, before, current, revision)) throw new Error('競合解決中にデータが変更されました。再度確認してください。');
  await flushFileSystemSync();
  });
}
export async function disconnectFileSystemSync() {
  stop();
  if (manualOperation) await manualOperation.catch(() => {});
  if (restoring) await restoring.catch(() => {});
  if (inFlight) await inFlight.catch(() => {});
  await savedFileSystemTarget(null);
  target = undefined;
  useCloudAuthStore.getState().disconnectCloudSync();
  useSyncReview.setState({ conflict: false });
}

export function startFileSystemSync() {
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (applying || manualOperation || !active() || !session || !healthy()) return;
    if (createPartializedState(state) === createPartializedState(previous)) return;
    pending = true;
    if (useCloudAuthStore.getState().syncStatus === 'synced') schedule();
  });
  const authUnsubscribe = useCloudAuthStore.subscribe((state, previous) => {
    if (state.provider === previous.provider && state.cloudSync === previous.cloudSync) return;
    if (!active()) stop();
    if (state.provider === 'filesystem' && !session && !manualOperation) void restore().catch(report);
  });
  const poll = setInterval(() => {
    if (!manualOperation && document.visibilityState === 'visible' && active() && session && useCloudAuthStore.getState().syncStatus === 'synced') {
      void flushFileSystemSync().catch(() => {});
    }
  }, 15000);
  const background = () => { if (!manualOperation && active() && session && useCloudAuthStore.getState().syncStatus === 'synced') void flushFileSystemSync().catch(() => {}); };
  document.addEventListener('visibilitychange', background);
  window.addEventListener('pagehide', background);
  if (useCloudAuthStore.getState().provider === 'filesystem' && healthy()) void restore().catch(report);
  return () => { unsubscribe(); authUnsubscribe(); clearInterval(poll); document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', background); stop(); };
}
