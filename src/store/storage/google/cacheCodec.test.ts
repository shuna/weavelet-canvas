import { afterEach, expect, it, vi } from 'vitest';
import { encodeCache, decodeCache } from './cacheCodec';
import { encode } from './crypto';
import { getSyncMetrics, resetSyncMetrics } from './metrics';

afterEach(() => vi.unstubAllGlobals());

it('round-trips small values, null, Unicode and a large fictional payload with native gzip', async () => {
  resetSyncMetrics();
  for (const value of [{ baseline: { field: 'hash' } }, null, ['日本語', '🙂', '\u0000'],
    { text: 'Fictional cache compression test. '.repeat(32768) }]) {
    const bytes = await encodeCache(value);
    expect([...bytes.slice(0, 8)]).toEqual([87, 76, 67, 65, 67, 72, 69, 1]);
    expect(await decodeCache(bytes)).toEqual(value);
  }
  expect(getSyncMetrics().serialize?.calls).toBe(4);
  expect(getSyncMetrics().compress?.calls).toBe(4);
});

it('reads legacy LZ caches and uses LZ when native compression is unavailable', async () => {
  const value = { baseline: { example: 'fictional' } };
  expect(await decodeCache(encode(value))).toEqual(value);
  expect(await decodeCache(encode(null))).toBe(null);
  vi.stubGlobal('CompressionStream', undefined);
  const bytes = await encodeCache(value);
  expect(bytes).toEqual(encode(value));
  expect(await decodeCache(bytes)).toEqual(value);
});

it('rejects unknown versions, missing decompressors, corrupt gzip and invalid JSON', async () => {
  const valid = await encodeCache({ fictional: 'value' });
  const future = valid.slice(); future[7] = 2;
  await expect(decodeCache(future)).rejects.toThrow('Unsupported sync cache format.');
  await expect(decodeCache(valid.slice(0, 7))).rejects.toThrow('Unsupported sync cache format.');
  await expect(decodeCache(valid.slice(0, 12))).rejects.toThrow('Invalid compressed sync cache.');
  const damaged = valid.slice(); damaged[damaged.length - 1] ^= 255;
  await expect(decodeCache(damaged)).rejects.toThrow('Invalid compressed sync cache.');
  const stream = new Blob(['not JSON private content']).stream().pipeThrough(new CompressionStream('gzip'));
  const gzip = new Uint8Array(await new Response(stream).arrayBuffer());
  const invalid = new Uint8Array(8 + gzip.length);
  invalid.set(valid.slice(0, 8)); invalid.set(gzip, 8);
  await expect(decodeCache(invalid)).rejects.toThrow('Invalid compressed sync cache.');
  vi.stubGlobal('DecompressionStream', undefined);
  await expect(decodeCache(valid)).rejects.toThrow('Native sync cache decompression is unavailable.');
  await expect(decodeCache(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});


it('keeps writing readable legacy caches when compression exists without decompression', async () => {
  const value = { baseline: { example: 'synthetic fallback fixture' } };
  expect(typeof CompressionStream).toBe('function');
  vi.stubGlobal('DecompressionStream', undefined);
  const bytes = await encodeCache(value);
  expect(bytes).toEqual(encode(value));
  expect(await decodeCache(bytes)).toEqual(value);
});
