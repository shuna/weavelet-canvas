import { afterEach, expect, it, vi } from 'vitest';
import { DriveTransport, nextSyncFolderName, DEFAULT_SYNC_FOLDER_NAME } from './transport';
import { listDriveFiles, getDriveFolderSize } from '@api/google-api';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => vi.unstubAllGlobals());

it('lists every commit page and filters by the encrypted dataset', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ files: [{ id: 'a' }], nextPageToken: 'next' }))
    .mockResolvedValueOnce(json({ files: [{ id: 'b' }] }));
  vi.stubGlobal('fetch', fetch);
  expect(await new DriveTransport(() => 'token').commits('dataset')).toEqual(['a', 'b']);
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toContain("'dataset' in parents");
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('pageToken')).toBe('next');
});

it('collects all changes pages before returning the next cursor', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ changes: [{ fileId: 'a' }], nextPageToken: 'page2' }))
    .mockResolvedValueOnce(json({ changes: [{ fileId: 'b' }], newStartPageToken: 'done' }));
  vi.stubGlobal('fetch', fetch);
  expect(await new DriveTransport(() => 'token').changes('start')).toEqual({
    changes: [{ fileId: 'a' }, { fileId: 'b' }], token: 'done',
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
