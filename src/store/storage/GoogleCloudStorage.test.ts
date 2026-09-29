import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  state: { provider: 'google', cloudSync: true, syncTargetConfirmed: true, googleAccessToken: 'token-1',
    fileId: 'file-1', syncStatus: 'synced', setSyncStatus: vi.fn() },
  local: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  push: vi.fn(), unlock: vi.fn(), close: vi.fn(), toast: vi.fn(), streaming: false,
}));
vi.mock('@store/cloud-auth-store', () => ({ default: { getState: () => mocks.state } }));
vi.mock('@store/store', () => ({ default: { getState: () => ({ theme: 'dark' }) } }));
vi.mock('@store/persistence', () => ({ createLocalStoragePartializedState: (s: unknown) => s }));
vi.mock('./IndexedDbStorage', () => ({ saveChatData: vi.fn() }));
vi.mock('./CompressedStorage', () => ({ default: mocks.local }));
vi.mock('@utils/showToast', () => ({ showToast: mocks.toast }));
vi.mock('@utils/streamingBuffer', () => ({ hasActiveStreamingBuffers: () => mocks.streaming }));
vi.mock('@api/google-api', () => ({ isGoogleAuthError: (e: Error) => /401/.test(e.message) }));
vi.mock('./google/sync', () => ({
  EncryptedDriveSync: class {
    constructor(public dataset: string) {}
    unlock = mocks.unlock;
    push = mocks.push;
    close = mocks.close;
  },
}));
import createGoogleCloudStorage, { flushPendingCloudSync, lockGoogleSync, unlockGoogleSync } from './GoogleCloudStorage';
const storage = () => createGoogleCloudStorage<{ count: number }>();

describe('GoogleCloudStorage encrypted upload scheduling', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    lockGoogleSync();
    vi.clearAllMocks();
    mocks.streaming = false;
    Object.assign(mocks.state, { provider: 'google', cloudSync: true, syncTargetConfirmed: true,
      googleAccessToken: 'token-1', fileId: 'file-1', syncStatus: 'synced' });
    mocks.state.setSyncStatus.mockImplementation((status) => { mocks.state.syncStatus = status; });
    mocks.push.mockResolvedValue(undefined);
    await unlockGoogleSync('file-1', 'password');
  });
  afterEach(() => { lockGoogleSync(); vi.useRealTimers(); });

  it('flushes the latest pending change after an in-flight upload finishes', async () => {
    let finish!: () => void;
    mocks.push.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await storage().setItem('test', { state: { count: 1 }, version: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    await storage().setItem('test', { state: { count: 2 }, version: 1 });
    finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenLastCalledWith({ state: { count: 2 }, version: 1 });
  });

  it('flushes changes queued while another flush is in flight', async () => {
    let finish!: () => void;
    mocks.push.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await storage().setItem('test', { state: { count: 1 } });
    await vi.advanceTimersByTimeAsync(5000);
    const waiting = flushPendingCloudSync();
    await storage().setItem('test', { state: { count: 2 } });
    finish();
    await waiting;
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it('does not send queued data to a different target or provider', async () => {
    await storage().setItem('test', { state: { count: 3 } });
    mocks.state.fileId = 'file-2';
    mocks.state.googleAccessToken = 'token-2';
    await flushPendingCloudSync();
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.state.fileId = 'file-1';
    mocks.state.provider = 'cloudkit';
    await flushPendingCloudSync();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('retains failed uploads for retry and keeps existing local storage active', async () => {
    mocks.push.mockRejectedValueOnce(new Error('network failed'));
    await storage().setItem('test', { state: { count: 4 }, version: 1 });
    await expect(flushPendingCloudSync()).rejects.toThrow('network failed');
    expect(mocks.local.setItem).toHaveBeenCalledWith('test', JSON.stringify({ state: { theme: 'dark' }, version: 1 }));
    await flushPendingCloudSync();
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it('saves locally while locked and never uploads streaming snapshots', async () => {
    mocks.streaming = true;
    await storage().setItem('test', { state: { count: 5 } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.push).not.toHaveBeenCalled();
    lockGoogleSync();
    mocks.streaming = false;
    await storage().setItem('test', { state: { count: 6 } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.local.setItem).toHaveBeenCalledTimes(2);
  });
});
