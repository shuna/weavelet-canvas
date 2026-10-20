import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ state: {} as any, setSession: vi.fn(), setLive: vi.fn() }));
vi.mock('@store/cloud-auth-store', () => ({ default: { getState: () => mocks.state } }));
vi.mock('@store/store', () => ({ default: { getState: () => ({ chats: ['unchanged'] }), setState: mocks.setLive } }));
vi.mock('@store/persistence', () => ({ needsDataMigration: () => false }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
import { fetchLegacyIOSCloudKitFile, downloadLegacyIOSCloudKitFile, assertLegacyIOSCloudKitPreview } from './legacyIOSCloudKit';

const record = (bytes = new TextEncoder().encode('{"snapshotVersion":99,"unknown":9007199254740993}')) => ({
  recordName: 'weavelet-ios-snapshot', recordType: 'WeaveletSnapshot', recordChangeTag: 'legacy-tag',
  fields: { payload: { value: Buffer.from(bytes).toString('base64'), type: 'BYTES' }, snapshotVersion: { value: 99 } },
});
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('VITE_CLOUDKIT_CONTAINER_ID', 'iCloud.test');
  vi.stubEnv('VITE_CLOUDKIT_API_TOKEN', 'api-token');
  mocks.state = { provider: 'cloudkit', cloudSync: true,
    providers: { cloudkit: { sessionToken: 'session-1', connectionId: 'connection-1', syncStatus: 'synced', recordChangeTag: 'canonical-tag', targetId: 'canonical-target', syncTargetConfirmed: true } },
    setProviderSession: mocks.setSession,
  };
  mocks.setSession.mockReset().mockImplementation((_provider, patch) => {
    mocks.state.providers.cloudkit = { ...mocks.state.providers.cloudkit, ...patch };
  });
  mocks.setLive.mockClear();
  request = vi.fn(async () => response({ records: [record()] }));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('old iOS CloudKit readonly source', () => {
  it('uses only the existing authenticated lookup, retains raw bytes, and updates only a rotated token', async () => {
    const before = structuredClone(mocks.state.providers.cloudkit);
    const original = record();
    request.mockResolvedValueOnce(response({ records: [original], ckWebAuthToken: 'rotated-token' }));
    const result = await fetchLegacyIOSCloudKitFile(() => true);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/private/records/lookup?'); expect(url).toContain('ckWebAuthToken=session-1');
    expect(options.method).toBe('POST'); expect(JSON.parse(options.body as string)).toEqual({ records: [{ recordName: 'weavelet-ios-snapshot' }] });
    expect(result!.file.name).toBe('weavelet-ios-snapshot.json');
    expect(Buffer.from(await result!.file.arrayBuffer()).toString('base64')).toBe(original.fields.payload.value);
    expect(mocks.state.providers.cloudkit).toEqual({ ...before, sessionToken: 'rotated-token' });
    expect(mocks.setSession).toHaveBeenCalledExactlyOnceWith('cloudkit', { sessionToken: 'rotated-token' });
    expect(mocks.setLive).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array([0x54,0x4c,0x56,0x57,99,0,255,0]), new Uint8Array([0x7b,0xff,0,0])])('preserves future or corrupt payload bytes before any decoding', async bytes => {
    request.mockResolvedValueOnce(response({ records: [record(bytes)] }));
    const result = await fetchLegacyIOSCloudKitFile(() => true);
    expect(new Uint8Array(await result!.file.arrayBuffer())).toEqual(bytes);
    expect(result!.file.name.endsWith(bytes[0] === 0x54 ? '.wvlt' : '.json')).toBe(true);
  });
  it('accepts a token rotation on the same connection and rejects a delayed response after reconnection', async () => {
    let finish!: (value: Response) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fetchLegacyIOSCloudKitFile(() => true);
    mocks.state.providers.cloudkit.sessionToken = 'rotated-during-read';
    finish(response({ records: [record()] }));
    expect((await pending)!.isCurrent()).toBe(true);
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stale = fetchLegacyIOSCloudKitFile(() => true);
    mocks.state.providers.cloudkit.connectionId = 'different-account';
    finish(response({ records: [record()], ckWebAuthToken: 'stale-token' }));
    await expect(stale).rejects.toThrow('接続が変更');
    expect(mocks.setSession).not.toHaveBeenCalled(); expect(mocks.setLive).not.toHaveBeenCalled();
  });
  it.each(['unmounted','provider','disconnected','unauthenticated'])('rejects delayed replies when %s without updating auth or live data', async change => {
    let finish!: (value: Response) => void, active = true;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fetchLegacyIOSCloudKitFile(() => active);
    if (change === 'unmounted') active = false;
    if (change === 'provider') mocks.state.provider = 'google';
    if (change === 'disconnected') mocks.state.cloudSync = false;
    if (change === 'unauthenticated') mocks.state.providers.cloudkit.syncStatus = 'unauthenticated';
    finish(response({ records: [record()], ckWebAuthToken: 'stale-token' }));
    await expect(pending).rejects.toThrow('接続が変更'); expect(mocks.setSession).not.toHaveBeenCalled();
  });
  it('handles absent records and rejects failures or malformed response records', async () => {
    request.mockResolvedValueOnce(response({ records: [{ serverErrorCode: 'RECORD_DOES_NOT_EXIST' }] }));
    expect(await fetchLegacyIOSCloudKitFile(() => true)).toBeNull();
    for (const data of [{ records: [{ serverErrorCode: 'AUTHENTICATION_REQUIRED' }] }, { records: [{ ...record(), recordName: 'weavelet-default-snapshot' }] }, { records: [{ ...record(), fields: {} }] }, { records: [record(new Uint8Array())] }]) {
      request.mockResolvedValueOnce(response(data));
      if ((data.records[0] as any).fields?.payload?.value === '') {
        expect((await fetchLegacyIOSCloudKitFile(() => true))!.file.size).toBe(0);
      } else await expect(fetchLegacyIOSCloudKitFile(() => true)).rejects.toThrow();
    }
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchLegacyIOSCloudKitFile(() => true)).rejects.toThrow('offline');
    expect(mocks.setLive).not.toHaveBeenCalled();
  });
  it.each([2, undefined, '1'])('preserves raw data but refuses preview for outer version %s even if inner JSON is v1', async snapshotVersion => {
    const raw = record(new TextEncoder().encode('{"snapshotVersion":1,"chats":[],"contentStore":{},"folders":{}}'));
    (raw.fields.snapshotVersion as any) = snapshotVersion === undefined ? undefined : { value: snapshotVersion };
    request.mockResolvedValueOnce(response({ records: [raw] }));
    const snapshot = (await fetchLegacyIOSCloudKitFile(() => true))!;
    expect(snapshot.file.size).toBeGreaterThan(0); expect(snapshot.isCurrent()).toBe(true);
    expect(() => assertLegacyIOSCloudKitPreview(snapshot)).toThrow('この版');
  });
  it('downloads the original File without decoding and refuses stale-account downloads', async () => {
    const snapshot = (await fetchLegacyIOSCloudKitFile(() => true))!;
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const create = vi.fn(() => 'blob:raw'); const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    downloadLegacyIOSCloudKitFile(snapshot);
    expect(create).toHaveBeenCalledExactlyOnceWith(snapshot.file); expect(link.download).toBe(snapshot.file.name);
    expect(link.click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:raw');
    mocks.state.providers.cloudkit.connectionId = 'changed';
    expect(() => downloadLegacyIOSCloudKitFile(snapshot)).toThrow('接続が変更'); expect(create).toHaveBeenCalledOnce();
  });
});
