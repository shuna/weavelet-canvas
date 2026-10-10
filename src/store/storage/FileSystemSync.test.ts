import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  state: { chats: [], contentStore: {}, theme: 'local' } as any,
  auth: {} as any, saved: undefined as any,
  blocked: false, push: vi.fn(), pull: vi.fn(), save: vi.fn(), accept: vi.fn(),
  target: vi.fn(), unlock: vi.fn(), restore: vi.fn(),
}));
vi.mock('@store/store', () => ({ default: { getState: () => mocks.state, setState: (value: any) => { mocks.state = { ...mocks.state, ...value }; }, subscribe: () => () => {} } }));
vi.mock('@store/cloud-auth-store', () => ({ default: { getState: () => mocks.auth, subscribe: () => () => {} } }));
vi.mock('@store/persistence', () => ({ createPartializedState: (value: any) => value,
  prepareHydratedState: async (_old: any, value: any) => value, finishHydratedState: (value: any) => value, migratePersistedState: (value: any) => value }));
vi.mock('./IndexedDbStorage', () => ({ areChatDataWritesBlocked: () => mocks.blocked, saveChatData: mocks.save }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@utils/streamingBuffer', () => ({ hasActiveStreamingBuffers: () => false }));
vi.mock('./google/processing', () => ({ sameSnapshotAsync: async (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b) }));
vi.mock('./google/conflicts', () => ({ markSyncChanges: vi.fn(), SyncConflictError: class extends Error {}, useSyncReview: { setState: vi.fn() } }));
vi.mock('./filesystem/handleStore', () => ({ savedFileSystemTarget: mocks.target }));
vi.mock('./filesystem/transport', () => ({ FileSystemTransport: class { async manifest() { return { dataset: 'remote' }; } async keyHeader() { return 'header'; } } }));
vi.mock('./sync/EncryptedSync', () => ({ EncryptedSync: class {
  push = mocks.push; pull = mocks.pull; acceptLocal = mocks.accept;
  synchronize = async (snapshot: unknown) => { await mocks.push(snapshot); return mocks.pull(); };
  unlock = mocks.unlock; restoreKey = mocks.restore; close = vi.fn();
  async resumeCreation() {}
} }));
let service: typeof import('./FileSystemSync');
const handle = { name: 'sync', requestPermission: async () => 'granted', queryPermission: async () => 'granted' } as unknown as FileSystemDirectoryHandle;
const remote = { version: 18, state: { chats: [], contentStore: {}, theme: 'remote' } };

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.blocked = false; mocks.saved = undefined;
  mocks.state = { chats: [], contentStore: {}, theme: 'local' };
  mocks.auth = { provider: 'filesystem', cloudSync: false, syncTargetConfirmed: false, syncStatus: 'unauthenticated',
    setProvider: (provider: string) => { mocks.auth.provider = provider; },
    setProviderSession: (_provider: string, value: any) => { Object.assign(mocks.auth, value, { remoteTargetId: value.targetId ?? mocks.auth.remoteTargetId }); },
    setCloudSync: (value: boolean) => { mocks.auth.cloudSync = value; },
    disconnectCloudSync: () => { mocks.auth.cloudSync = false; mocks.auth.syncTargetConfirmed = false; },
  };
  mocks.target.mockImplementation(async (value?: any) => { if (value !== undefined) mocks.saved = value ?? undefined; return mocks.saved; });
  mocks.pull.mockResolvedValue(remote); mocks.push.mockResolvedValue(undefined); mocks.restore.mockResolvedValue(true);
  mocks.accept.mockResolvedValue(undefined); mocks.save.mockResolvedValue(undefined);
  service = await import('./FileSystemSync');
});
afterEach(async () => { await service.disconnectFileSystemSync(); });

it('retries a failed initial download without publishing local state or pending commits', async () => {
  mocks.pull.mockRejectedValueOnce(new Error('not yet arrived'));
  await expect(service.connectFileSystemSync(handle, 'passphrase', false)).rejects.toThrow('not yet arrived');
  expect(mocks.state.theme).toBe('local');
  expect(mocks.saved.downloadPending).toBe(true);
  expect(mocks.push).not.toHaveBeenCalled();
  await service.reconnectFileSystemSync('passphrase');
  expect(mocks.pull.mock.calls).toEqual([[false], [false]]);
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.accept).toHaveBeenCalledWith(remote, true);
  expect(mocks.state.theme).toBe('remote');
  expect(mocks.saved.downloadPending).toBe(false);
  await service.flushFileSystemSync();
  expect(mocks.push).toHaveBeenCalled();
});

it('keeps local state if saving downloaded chat data fails', async () => {
  mocks.save.mockRejectedValueOnce(new Error('quota'));
  await expect(service.connectFileSystemSync(handle, 'passphrase', false)).rejects.toThrow('quota');
  expect(mocks.state.theme).toBe('local');
  expect(mocks.accept).not.toHaveBeenCalled();
  expect(mocks.saved.downloadPending).toBe(true);
});

it('refuses to connect when bootstrap has blocked writes', async () => {
  mocks.blocked = true;
  await expect(service.connectFileSystemSync(handle, 'passphrase', false)).rejects.toThrow('復旧');
  expect(mocks.unlock).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});

it('does not reactivate a connection disconnected while its handle is being persisted', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.target.mockImplementationOnce(async (value: any) => { await gate; mocks.saved = value; });
  const connection = service.connectFileSystemSync(handle, 'passphrase', false);
  await vi.waitFor(() => expect(mocks.target).toHaveBeenCalled());
  const disconnect = service.disconnectFileSystemSync();
  release();
  await Promise.all([connection, disconnect]);
  expect(mocks.auth.cloudSync).toBe(false);
  expect(mocks.saved).toBeUndefined();
  expect(mocks.push).not.toHaveBeenCalled();
});
