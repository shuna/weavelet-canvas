import { afterEach, expect, it, vi } from 'vitest';
import { DriveTransport, nextSyncFolderName, DEFAULT_SYNC_FOLDER_NAME } from './transport';
import useCloudAuthStore from '@store/cloud-auth-store';
import { listDriveFiles, getDriveFolderSize } from '@api/google-api';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('lists every commit page and filters by the encrypted dataset', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [{ id: 'a' }], nextPageToken: 'next' }))
    .mockResolvedValueOnce(json({ files: [{ id: 'b' }] }));
  vi.stubGlobal('fetch', fetch);
  expect(await new DriveTransport(() => 'token').commits('dataset')).toEqual(['a', 'b']);
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toContain("'dataset' in parents");
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('pageToken')).toBe('next');
});

it('gets commits and pack indexes in one validated history scan', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [
    { id: 'commit', appProperties: { kind: 'commit' } }, { id: 'pack', appProperties: { kind: 'pack' } },
  ], nextPageToken: 'next' })).mockResolvedValueOnce(json({ files: [] }));
  vi.stubGlobal('fetch', fetch);
  expect(await new DriveTransport(() => 'token').history('dataset')).toEqual({ commits: ['commit'], packs: ['pack'] });
  const first = new URL(fetch.mock.calls[0][0]);
  expect(first.searchParams.get('q')).toContain("(appProperties has { key='kind' and value='commit' } or appProperties has { key='kind' and value='pack' })");
  expect(first.searchParams.get('fields')).toBe('nextPageToken,incompleteSearch,files(id,appProperties(kind))');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('rejects malformed or cyclic listing and change cursors', async () => {
  const drive = new DriveTransport(() => 'token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files: [], nextPageToken: '' })));
  await expect(drive.history('dataset')).rejects.toThrow('listing token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ changes: [], nextPageToken: 'start' })));
  await expect(drive.changes('start')).rejects.toThrow('change token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files: [{ id: 'bad', appProperties: { kind: 'part' } }] })));
  await expect(drive.history('dataset')).rejects.toThrow('history listing');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ files: [], nextPageToken: 'again' })).mockResolvedValueOnce(json({ files: [], nextPageToken: 'again' })));
  await expect(drive.history('dataset')).rejects.toThrow('listing token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ changes: [] })));
  await expect(drive.changes('start')).rejects.toThrow('change token');
});

it('retries a throttled response with backoff and preserves the response when its retry budget is exhausted', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
    .mockResolvedValueOnce(json({ startPageToken: 'done' }));
  vi.stubGlobal('fetch', fetch);
  const pending = new DriveTransport(() => 'token').startToken();
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(pending).resolves.toBe('done');
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

it('uses at most three retries, respects Retry-After lower bounds, and skips waits beyond its budget', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const exhausted = new DriveTransport(() => 'token').startToken();
  const failed = expect(exhausted).rejects.toThrow('503');
  await vi.runAllTimersAsync(); await failed;
  expect(fetch).toHaveBeenCalledTimes(4);
  const date = new Date(Date.now() + 31_000).toUTCString();
  fetch.mockClear().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': date } }));
  await expect(new DriveTransport(() => 'token').startToken()).rejects.toThrow('429');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not retry network failures, aborted requests, or a changed direct-token account', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
  await expect(new DriveTransport(() => 'token').startToken()).rejects.toThrow('aborted');
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
  let token = 'first';
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const pending = new DriveTransport(() => token).startToken();
  const stopped = expect(pending).rejects.toThrow('503');
  token = 'second';
  await vi.advanceTimersByTimeAsync(1_000);
  await stopped;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('stops retrying when the authenticated backend connection changes', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
  const previous = useCloudAuthStore.getState().providers.google.connectionId;
  useCloudAuthStore.getState().setProviderSession('google', { connectionId: 'first' });
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const pending = new DriveTransport(() => 'token').startToken();
  const stopped = expect(pending).rejects.toThrow('503');
  useCloudAuthStore.getState().setProviderSession('google', { connectionId: 'second' });
  await vi.advanceTimersByTimeAsync(1_000); await stopped;
  expect(fetch).toHaveBeenCalledTimes(1);
  useCloudAuthStore.getState().setProviderSession('google', { connectionId: previous });
});

it('retries only the documented 403 rate-limit reasons and stops after an account or abort change', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const limited = json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403);
  const fetch = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(json({ startPageToken: 'done' }));
  vi.stubGlobal('fetch', fetch);
  const pending = new DriveTransport(() => 'token').startToken();
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(pending).resolves.toBe('done');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { errors: [{ reason: 'forbidden' }] } }, 403)));
  await expect(new DriveTransport(() => 'token').startToken()).rejects.toThrow('403');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('recovers a lost folder-create response only for its exact live folder', async () => {
  vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(json({ id: 'folder', mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId: 'header' } }));
  vi.stubGlobal('fetch', fetch);
  const pending = new DriveTransport(() => 'token').folder('folder', 'header');
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(pending).resolves.toMatchObject({ id: 'folder' });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects a conflicting or trashed folder after a 409 create response', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(json({ id: 'folder', trashed: false, mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId: 'other' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(new DriveTransport(() => 'token').folder('folder', 'header')).rejects.toThrow('409');
  fetch.mockReset().mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(json({ id: 'folder', trashed: true, mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId: 'header' } }));
  await expect(new DriveTransport(() => 'token').folder('folder', 'header')).rejects.toThrow('deleted');
});

it('collects all changes pages before returning the next cursor', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ changes: [{ fileId: 'a' }], nextPageToken: 'page2' }))
    .mockResolvedValueOnce(json({ changes: [{ fileId: 'b' }], newStartPageToken: 'done' }));
  vi.stubGlobal('fetch', fetch);
  expect(await new DriveTransport(() => 'token').changes('start')).toEqual({
    changes: [{ id: 'a' }, { id: 'b' }], token: 'done',
  });
});

it('verifies identical bytes after a duplicate-ID response and uses refreshed tokens', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  let token = 'old';
  const drive = new DriveTransport(() => token);
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal('fetch', fetch);
  token = 'new';
  await drive.put('file', 'dataset', 'part', bytes);
  expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer new');
  const body = await (fetch.mock.calls[0][1].body as Blob).text();
  expect(body).toContain('"id":"file"');
  expect(body).toContain('"parents":["dataset"]');
  fetch.mockResolvedValueOnce(new Response('', { status: 409 })).mockResolvedValueOnce(new Response(new Uint8Array([9])));
  await expect(drive.put('file', 'dataset', 'part', bytes)).rejects.toThrow('collision');
});

it('does not parse a 401 or incomplete file listing as an empty successful sync', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
  await expect(new DriveTransport(() => 'token').read('file')).rejects.toThrow('401');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files: [], incompleteSearch: true })));
  await expect(listDriveFiles('token')).rejects.toThrow('Incomplete');
});

it('lists encrypted folders and legacy files without exposing internal encrypted parts in the picker', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [{ id: 'folder' }], nextPageToken: 'next' }))
    .mockResolvedValueOnce(json({ files: [{ id: 'legacy' }] }));
  vi.stubGlobal('fetch', fetch);
  expect((await listDriveFiles('token')).files.map((f) => f.id)).toEqual(['folder', 'legacy']);
  const q = new URL(fetch.mock.calls[0][0]).searchParams.get('q');
  expect(q).toContain('weaveletSync');
  expect(q).toContain("name contains '.json'");
});

it('batches generated IDs within the Drive limit and rejects duplicate responses', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ ids: Array.from({ length: 1000 }, (_, i) => `id-${i}`) }))
    .mockResolvedValueOnce(json({ ids: ['last'] }));
  vi.stubGlobal('fetch', fetch);
  const drive = new DriveTransport(() => 'token');
  expect(await drive.ids(1001)).toHaveLength(1001);
  expect(fetch.mock.calls.map(c => new URL(c[0]).searchParams.get('count'))).toEqual(['1000', '1']);
  fetch.mockResolvedValueOnce(json({ ids: ['same', 'same'] }));
  await expect(drive.ids(2)).rejects.toThrow('duplicate');
  fetch.mockResolvedValueOnce(json({ ids: [] }));
  await expect(drive.ids(2)).rejects.toThrow('requested');
});

it('sums every page of folder metadata including key, data and commit sizes without downloading files', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [{ id: 'key', size: '353' }, { id: 'part', size: '1048604' }], nextPageToken: 'next' }))
    .mockResolvedValueOnce(json({ files: [{ id: 'commit', size: '200' }] }));
  vi.stubGlobal('fetch', fetch);
  expect(await getDriveFolderSize('dataset', 'token')).toBe('1049157');
  const urls = fetch.mock.calls.map(c => new URL(c[0]));
  expect(urls[0].searchParams.get('q')).toContain("'dataset' in parents and trashed = false");
  expect(urls[0].searchParams.get('fields')).toBe('nextPageToken,incompleteSearch,files(id,size)');
  expect(urls[1].searchParams.get('pageToken')).toBe('next');
  expect(urls.every(url => url.pathname.endsWith('/files') && !url.searchParams.has('alt'))).toBe(true);
});

it('reports empty folders as zero and rejects unknown or incomplete size totals', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [] }))
    .mockResolvedValueOnce(json({ files: [{ id: 'missing-size' }] }))
    .mockResolvedValueOnce(json({ files: [{ size: '10' }], incompleteSearch: true }));
  vi.stubGlobal('fetch', fetch);
  expect(await getDriveFolderSize('empty', 'token')).toBe('0');
  await expect(getDriveFolderSize('unknown', 'token')).rejects.toThrow('determine');
  await expect(getDriveFolderSize('partial', 'token')).rejects.toThrow('Incomplete');
});


it('suggests unused folder names and sends editable names without changing identity', async () => {
  expect(nextSyncFolderName(DEFAULT_SYNC_FOLDER_NAME, [])).toBe(DEFAULT_SYNC_FOLDER_NAME);
  expect(nextSyncFolderName(DEFAULT_SYNC_FOLDER_NAME, [DEFAULT_SYNC_FOLDER_NAME, `${DEFAULT_SYNC_FOLDER_NAME} (2)`])).toBe(`${DEFAULT_SYNC_FOLDER_NAME} (3)`);
  expect(nextSyncFolderName('  私の同期  ', ['私の同期'])).toBe('私の同期 (2)');
  expect(nextSyncFolderName('Custom', [DEFAULT_SYNC_FOLDER_NAME])).toBe('Custom');
  const fetch = vi.fn().mockResolvedValue(json({ id: 'folder', name: 'Custom name' }));
  vi.stubGlobal('fetch', fetch);
  const drive = new DriveTransport(() => 'token');
  await drive.folder('folder', 'header', '  Custom name  ');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ id: 'folder', name: 'Custom name', appProperties: { headerId: 'header', weaveletSync: '1' } });
  await expect(drive.folder('folder', 'header', '  ')).rejects.toThrow('name');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('lists all live pack indexes separately from commits', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [{ id: 'pack1' }], nextPageToken: 'next' }))
    .mockResolvedValueOnce(json({ files: [{ id: 'pack2' }] }));
  vi.stubGlobal('fetch', fetch);
  expect(await new DriveTransport(() => 'token').packs('dataset')).toEqual(['pack1', 'pack2']);
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toContain("value='pack'");
});

it('retries source deletion idempotently but preserves authentication and server errors', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const drive = new DriveTransport(() => 'token');
  await drive.remove('source');
  await drive.remove('source');
  await expect(drive.remove('source')).rejects.toThrow('403');
  expect(fetch.mock.calls[0][1].method).toBe('DELETE');
});

it('normalizes Drive metadata and change events for the shared sync engine', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'dataset', mimeType: 'application/vnd.google-apps.folder',
    appProperties: { weaveletSync: '1', headerId: 'key' } }))
    .mockResolvedValueOnce(json({ changes: [
      { fileId: 'commit', file: { appProperties: { dataset: 'dataset', kind: 'commit' } } },
      { fileId: 'trashed', file: { trashed: true } }, { fileId: 'deleted', removed: true },
    ], newStartPageToken: 'done' }));
  vi.stubGlobal('fetch', fetch);
  const drive = new DriveTransport(() => 'token');
  expect(await drive.keyHeader('dataset')).toBe('key');
  expect(await drive.changes('start')).toEqual({ token: 'done', changes: [
    { id: 'commit', dataset: 'dataset', kind: 'commit' },
    { id: 'trashed', removed: true }, { id: 'deleted', removed: true },
  ] });
});

it.each([
  { mimeType: 'application/json' },
  { mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1' } },
])('rejects a dataset without valid encrypted folder metadata', async (file) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(file)));
  await expect(new DriveTransport(() => 'token').keyHeader('dataset')).rejects.toThrow('read-only');
});
