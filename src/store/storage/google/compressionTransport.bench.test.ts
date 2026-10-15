import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { measureCompressionTransport } from './compressionTransport.bench';
import * as storage from './cache';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('round-trips binary frames at multipart boundaries, accounts actual ciphertext and removes only its temporary entries', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const sentinel = new Uint8Array([1, 3, 5]);
  await storage.writeSyncCache('unrelated-synthetic-dataset', undefined, [['untouched', sentinel]]);
  const writes = vi.spyOn(storage, 'writeSyncCache');
  for (const size of [20, 1024 * 1024, 1024 * 1024 + 1]) {
    writes.mockClear();
    const frame = new Uint8Array(size).fill(71);
    frame.set([87, 67, 66, 49]); // Synthetic binary frame header, not message data.
    frame[frame.length - 1] = 255;
    const before = frame.slice();
    const measured = await measureCompressionTransport(frame);
    const parts = Math.ceil(size / (1024 * 1024));
    expect(measured.parts).toBe(parts);
    expect(measured.fileCount).toBe(parts + 1);
    expect(measured.payloadCiphertextBytes).toBe(size + parts * 28);
    expect(measured.manifestCiphertextBytes).toBe(measured.manifestPlainBytes + 28);
    expect(measured.ciphertextBytes).toBe(measured.payloadCiphertextBytes + measured.manifestCiphertextBytes);
    for (const ms of [measured.encryptMs, measured.decryptMs, measured.writeMs, measured.readMs]) {
      expect(Number.isFinite(ms) && ms >= 0).toBe(true);
    }
    const [dataset, session, entries] = writes.mock.calls[0];
    expect(dataset.startsWith('compression-transport-bench:')).toBe(true);
    expect(session).toBeUndefined();
    expect(entries).toHaveLength(parts + 1);
    expect(entries!.reduce((total, [, bytes]) => total + bytes.length, 0)).toBe(measured.ciphertextBytes);
    expect(await storage.readSyncEntries(dataset, entries!.map(([id]) => id))).toEqual(entries!.map(() => undefined));
    expect(await storage.syncCache(dataset)).toBeUndefined();
    expect(frame.every((byte, i) => byte === before[i])).toBe(true);
  }
  for (const size of [1, 1024 * 1024]) {
    writes.mockClear();
    const bytes = new Uint8Array(size).fill(17);
    const measured = await measureCompressionTransport(bytes, { inline: true });
    expect(measured.parts).toBe(1);
    expect(measured.fileCount).toBe(1);
    expect(measured.manifestPlainBytes).toBe(0);
    expect(measured.manifestCiphertextBytes).toBe(0);
    expect(measured.payloadCiphertextBytes).toBe(size + 28);
    expect(measured.ciphertextBytes).toBe(size + 28);
    const [dataset, , entries] = writes.mock.calls[0];
    expect(entries).toHaveLength(1);
    expect(await storage.readSyncEntries(dataset, entries!.map(([id]) => id))).toEqual([undefined]);
  }
  writes.mockClear();
  for (const size of [0, 1024 * 1024 + 1]) {
    await expect(measureCompressionTransport(new Uint8Array(size), { inline: true })).rejects.toThrow('Inline benchmark payload');
  }
  expect(writes).not.toHaveBeenCalled();
  const empty = await measureCompressionTransport(new Uint8Array());
  expect(empty.parts).toBe(0);
  expect(empty.fileCount).toBe(1);
  expect(empty.payloadCiphertextBytes).toBe(0);
  expect(empty.ciphertextBytes).toBe(empty.manifestCiphertextBytes);
  expect(await storage.readSyncEntries('unrelated-synthetic-dataset', ['untouched'])).toEqual([sentinel]);
});
