import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// This isolated hook host retains refs/state and runs cleanup without a browser or network.
const host = vi.hoisted(() => ({ cursor: 0, slots: [] as any[], effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[], updates: 0 }));
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), download: vi.fn(), prepare: vi.fn(), preview: vi.fn(), live: vi.fn(), storage: vi.fn(), current: true,
  auth: { provider: 'cloudkit', cloudSync: true, syncStatus: 'synced', syncTargetConfirmed: false,
    providers: { cloudkit: { sessionToken: 'token', connectionId: 'connection', syncStatus: 'synced' } } } as any,
}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual,
    useState: (initial: unknown) => {
      const index = host.cursor++;
      if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [host.slots[index], (value: any) => { host.updates++; host.slots[index] = typeof value === 'function' ? value(host.slots[index]) : value; }];
    },
    useRef: (initial: unknown) => { const index = host.cursor++; return host.slots[index] ??= { current: initial }; },
    useEffect: (effect: () => void | (() => void)) => { const index = host.cursor++; if (!(index in host.slots)) { host.slots[index] = true; host.effects.push(effect); } },
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options: any) => typeof options === 'string' ? options : options?.defaultValue ?? key }) }));
vi.mock('@store/cloud-auth-store', () => ({ default: Object.assign((select: (state: any) => unknown) => select(mocks.auth), { getState: () => mocks.auth }) }));
vi.mock('@store/store', () => ({ default: { setState: mocks.live, getState: () => ({ chats: ['live'] }), persist: { setOptions: mocks.storage } } }));
vi.mock('@api/cloudkit', async importOriginal => ({ ...await importOriginal<typeof import('@api/cloudkit')>(), getCloudKitConfig: () => ({ containerId: 'test', environment: 'development', apiToken: 'api' }) }));
vi.mock('@store/storage/CloudKitCloudStorage', () => ({ default: () => ({}), flushPendingCloudKitSync: vi.fn() }));
vi.mock('@store/persistence', () => ({ createLocalStoragePartializedState: vi.fn(), createPartializedState: vi.fn(), hydrateFromPersistedStoreState: vi.fn(), needsDataMigration: () => false }));
vi.mock('@src/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@components/ImportExportChat/importService', () => ({ prepareImportPreview: mocks.prepare }));
vi.mock('@components/ImportExportChat/LocalFilePreview', () => ({ useImportPreviewSession: { setState: mocks.preview } }));
vi.mock('@utils/legacyIOSCloudKit', async importOriginal => ({
  ...await importOriginal<typeof import('@utils/legacyIOSCloudKit')>(), fetchLegacyIOSCloudKitFile: mocks.fetch, downloadLegacyIOSCloudKitFile: mocks.download,
}));
import CloudKitSync from './CloudKitSync';

function render() { host.cursor = 0; return CloudKitSync(); }
function buttons(element: any): ReactElement<any>[] {
  if (!element || typeof element !== 'object') return [];
  return [...(element.type === 'button' ? [element] : []), ...[element.props?.children].flat(Infinity).flatMap(buttons)];
}
function button(label: string) { const found = buttons(render()).find(element => element.props.children === label); if (!found) throw new Error(`Missing ${label}`); return found; }
const file = () => ({ file: new File(['{"snapshotVersion":1}'], 'old-ios.json'), snapshotVersion: 1, isCurrent: () => mocks.current });
function mount() { render(); for (const effect of host.effects) { const cleanup = effect(); if (cleanup) host.cleanups.push(cleanup); } }
function unmount() { for (const cleanup of host.cleanups) cleanup(); }
beforeEach(() => {
  host.cursor = 0; host.slots = []; host.effects = []; host.cleanups = []; host.updates = 0;
  vi.clearAllMocks(); mocks.current = true; mocks.auth.syncTargetConfirmed = false;
  mocks.fetch.mockResolvedValue(file()); mocks.prepare.mockResolvedValue({ chats: [], folders: {}, contentStore: {}, extensions: {} });
  mount();
});

describe('CloudKit old iOS controls', () => {
  it('suppresses rapid duplicate reads and offers raw download before preview without changing live data', async () => {
    let finish!: (value: ReturnType<typeof file>) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const click = button('旧iOSデータを取得').props.onClick;
    const first = click(), second = click();
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(button('旧iOSデータを取得').props.disabled).toBe(true);
    finish(file()); await Promise.all([first, second]);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
    button('原本を保存').props.onClick(); expect(mocks.download).toHaveBeenCalledOnce();
    await button('内容を確認').props.onClick();
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(expect.any(File), expect.any(Function));
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith({ source: expect.objectContaining({ chats: [] }), fileName: 'old-ios.json' });
    expect(mocks.live).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('retains the raw download when decoding fails and rejects preview for a future outer version', async () => {
    mocks.fetch.mockResolvedValueOnce({ ...file(), snapshotVersion: 2 });
    await button('旧iOSデータを取得').props.onClick();
    await button('内容を確認').props.onClick();
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
    button('原本を保存').props.onClick(); expect(mocks.download).toHaveBeenCalledOnce();
    await button('旧iOSデータを取得').props.onClick();
    mocks.prepare.mockRejectedValueOnce(new Error('Corrupt file'));
    await button('内容を確認').props.onClick();
    button('原本を保存').props.onClick(); expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.live).not.toHaveBeenCalled();
  });
  it('does not update React state after an in-flight read is unmounted', async () => {
    let finish!: (value: ReturnType<typeof file>) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = button('旧iOSデータを取得').props.onClick();
    const isActive = mocks.fetch.mock.calls[0][0];
    unmount(); const updates = host.updates; expect(isActive()).toBe(false);
    finish(file()); await pending; expect(host.updates).toBe(updates); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each(['auth', 'unmount'])('rejects an in-flight preview after %s changes', async change => {
    await button('旧iOSデータを取得').props.onClick();
    let finish!: (source: object) => void;
    mocks.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const click = button('内容を確認').props.onClick;
    const pending = click(); await click(); expect(mocks.prepare).toHaveBeenCalledOnce();
    if (change === 'auth') mocks.current = false; else unmount();
    const updates = host.updates; finish({ chats: [], folders: {}, contentStore: {} }); await pending;
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.live).not.toHaveBeenCalled();
    if (change === 'unmount') expect(host.updates).toBe(updates);
  });
});
