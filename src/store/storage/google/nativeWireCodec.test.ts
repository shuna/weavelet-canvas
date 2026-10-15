import { afterEach, expect, it, vi } from 'vitest';
import { decodeGzipJson, encodeGzipJson, nativeGzipAvailable } from './gzip';
import { decodeNativeParts, encodeNativeWire, hashNativeCommits, NATIVE_WIRE_MAX_BYTES } from './nativeWireCodec';
import { decodeCache, frameCacheGzip } from './cacheCodec';
import { digest, encode } from './crypto';
import { canonical } from './records';
import type { Commit } from './replay';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('round-trips native JSON and multipart slices without using or mixing cache framing', async () => {
  const value = { version: 1, parents: ['先行'], changes: [{ key: 'example', before: null, after: '🙂'.repeat(10000) }] };
  const bytes = await encodeGzipJson(value);
  expect([...bytes.slice(0, 2)]).toEqual([31, 139]);
  expect(await decodeGzipJson(bytes)).toEqual(value);
  const split = await decodeNativeParts([bytes.subarray(0, 7), bytes.subarray(7)]);
  expect(split.value).toEqual(value);
  expect(split.bytes).toEqual(bytes);
  expect(await decodeCache(frameCacheGzip(bytes))).toEqual(value);
  expect(await decodeCache(encode(value))).toEqual(value);
});

it('hashes JSON-safe canonical commits with a distinct versioned domain, preserving legacy hashes', async () => {
  const first: Commit = { parents: [], changes: [{ before: null, after: '日本語', key: 'example' }], version: 1 };
  const second: Commit = { version: 1, changes: [{ key: 'example', after: '日本語', before: null }], parents: [], resolutions: undefined };
  const hashes = await hashNativeCommits({ first, second });
  expect(hashes.first).toBe(hashes.second);
  expect(hashes.first).toBe(await digest('weavelet-sync-commit:2\n' + canonical(JSON.parse(JSON.stringify(first)))));
  expect(hashes.first).not.toBe(await digest(encode(first)));
  expect((await hashNativeCommits({ changed: { ...first, parents: ['other'] } })).changed).not.toBe(hashes.first);
});

it('rejects broken gzip, invalid JSON and unavailable native writers without leaking parser text', async () => {
  const bytes = await encodeGzipJson({ private: 'synthetic marker' });
  await expect(decodeGzipJson(bytes.subarray(0, 12))).rejects.toThrow('Invalid native sync gzip data.');
  const stream = new Blob(['private synthetic text that is not JSON']).stream().pipeThrough(new CompressionStream('gzip'));
  const invalid = new Uint8Array(await new Response(stream).arrayBuffer());
  try { await decodeGzipJson(invalid); throw new Error('Expected rejection'); }
  catch (error) { expect((error as Error).message).toBe('Invalid native sync gzip data.'); }
  await expect(encodeGzipJson(undefined)).rejects.toThrow('Invalid native sync value.');
  vi.stubGlobal('CompressionStream', class { constructor() { throw new Error('unsupported gzip'); } });
  expect(nativeGzipAvailable()).toBe(false);
  await expect(encodeGzipJson({})).rejects.toThrow('Native sync gzip is unavailable.');
});

it('requires working compression and decompression constructors before allowing native writes', async () => {
  vi.stubGlobal('DecompressionStream', class { constructor() { throw new Error('unsupported gzip decoder'); } });
  expect(nativeGzipAvailable()).toBe(false);
  await expect(encodeGzipJson({})).rejects.toThrow('Native sync gzip is unavailable.');
});

it('uses one actual UTF-8 byte limit for native readers and writers, including the exact boundary', async () => {
  const value = { text: 'ASCII is cheaper than the conservative grouping bound. '.repeat(20) + '日本語🙂' };
  const size = new TextEncoder().encode(JSON.stringify(value)).length;
  const bytes = await encodeNativeWire(value, size);
  expect((await decodeNativeParts([bytes], size)).value).toEqual(value);
  await expect(encodeNativeWire(value, size - 1)).rejects.toThrow('Native sync payload exceeds the byte limit.');
  await expect(decodeNativeParts([bytes], size - 1)).rejects.toThrow('Native sync payload exceeds the byte limit.');
  expect(NATIVE_WIRE_MAX_BYTES).toBe(256 * 1024 * 1024);
});

it('stops highly compressed payload expansion before parsing JSON, while local cache gzip remains unbounded', async () => {
  const value = { text: 'Synthetic decompression limit test. '.repeat(20000) };
  const bytes = await encodeGzipJson(value);
  expect(bytes.length).toBeLessThan(4096);
  const parsing = vi.spyOn(JSON, 'parse');
  await expect(decodeNativeParts([bytes], 1024)).rejects.toThrow('Native sync payload exceeds the byte limit.');
  expect(parsing).not.toHaveBeenCalled();
  parsing.mockRestore();
  expect(await decodeCache(frameCacheGzip(bytes))).toEqual(value);
});
