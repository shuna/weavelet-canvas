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

it('matches the previous native digest for JSON normalization edge cases and lexical key ordering', async () => {
  const values = [
    { version: 1, parents: [], changes: [{ key: 'synthetic', before: null, after: '\\"\n日本語🙂\ud800' }], resolutions: undefined },
    { version: 1, parents: [], changes: [], extra: { z: undefined, zero: -0, nan: NaN, infinite: Infinity,
      array: [undefined, , NaN, Symbol('ignored'), () => 'ignored'], numeric: { 2: 'two', 10: 'ten', 1: 'one' } } },
    { version: 1, parents: [], changes: [], extra: JSON.parse('{"__proto__":{"literal":true},"constructor":"literal","prototype":true}') },
    { version: 1, parents: [], changes: [], extra: Object.assign(Object.create(null), { value: 'synthetic' }) },
  ];
  for (const value of values) {
    const expected = await digest('weavelet-sync-commit:2\n' + canonical(JSON.parse(JSON.stringify(value))));
    expect((await hashNativeCommits({ synthetic: value as Commit })).synthetic).toBe(expected);
  }
});

it('avoids full JSON round-trip copies for plain commits, retaining the exact SHA', async () => {
  const value: Commit = { version: 1, parents: [], changes: [{ key: 'synthetic', before: null, after: 'Fictional body '.repeat(30000) }] };
  const expected = await digest('weavelet-sync-commit:2\n' + canonical(JSON.parse(JSON.stringify(value))));
  const parsing = vi.spyOn(JSON, 'parse'), serializing = vi.spyOn(JSON, 'stringify');
  expect((await hashNativeCommits({ synthetic: value })).synthetic).toBe(expected);
  expect(parsing).not.toHaveBeenCalled();
  expect(serializing.mock.calls.some(([input]) => input === value)).toBe(false);
});

it('preserves custom JSON conversion, getter and shared-value behavior through the original fallback', async () => {
  const shared = { value: 'synthetic' };
  const values = [
    { version: 1, parents: [], changes: [], extra: new Date('2026-01-01T00:00:00Z') },
    { version: 1, parents: [], changes: [], extra: { toJSON: (key: string) => ({ key, synthetic: true }) } },
    { version: 1, parents: [], changes: [], extra: { get synthetic() { return 'accessor'; } } },
    { version: 1, parents: [], changes: [], first: shared, second: shared },
    { version: 1, parents: [], changes: [], extra: { toJSON: 'non-function' } },
    { version: 1, parents: [], changes: [], extra: Object.assign(() => 'unused', { toJSON: () => 'synthetic function JSON' }) },
  ];
  for (const value of values) {
    const expected = await digest('weavelet-sync-commit:2\n' + canonical(JSON.parse(JSON.stringify(value))));
    expect((await hashNativeCommits({ synthetic: value as Commit })).synthetic).toBe(expected);
  }
  const cyclic: any = { version: 1, parents: [], changes: [] }; cyclic.extra = cyclic;
  await expect(hashNativeCommits({ synthetic: cyclic })).rejects.toThrow();
  await expect(hashNativeCommits({ synthetic: undefined as unknown as Commit })).rejects.toThrow();
  await expect(hashNativeCommits({ synthetic: { version: 1, parents: [], changes: [], extra: 1n } as Commit })).rejects.toThrow();
});
