import { afterEach, expect, it, vi } from 'vitest';
import { DriveTransport } from './transport';
import { listDriveFiles } from '@api/google-api';
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
