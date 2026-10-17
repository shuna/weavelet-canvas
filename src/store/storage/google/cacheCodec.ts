import { decode, encode } from './crypto';
import { recordMetric } from './metrics';

// Local cache only. Remote commits/packs keep their existing encoding and hashes.
const magic = new Uint8Array([87, 76, 67, 65, 67, 72, 69]); // WLCACHE
const version = 1;

export async function encodeCache(value: unknown): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return encode(value);
  const started = performance.now();
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Invalid sync cache value.');
  const input = new TextEncoder().encode(json);
  recordMetric('serialize', started, input.length, input.length);
  const compressStarted = performance.now();
  const stream = new Blob([input.buffer]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const result = new Uint8Array(magic.length + 1 + compressed.length);
  result.set(magic);
  result[magic.length] = version;
  result.set(compressed, magic.length + 1);
  recordMetric('compress', compressStarted, input.length, result.length);
  return result;
}

export async function decodeCache<T>(bytes: Uint8Array): Promise<T> {
  if (!magic.every((byte, index) => bytes[index] === byte)) return decode<T>(bytes);
  if (bytes[magic.length] !== version) throw new Error('Unsupported sync cache format.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Native sync cache decompression is unavailable.');
  try {
    const compressed = new Uint8Array(bytes.subarray(magic.length + 1));
    const stream = new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await new Response(stream).arrayBuffer());
    return JSON.parse(json) as T;
  } catch {
    // Native parser errors can include private text; expose only a fixed message.
    throw new Error('Invalid compressed sync cache.');
  }
}
