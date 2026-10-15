import { decode, encode } from './crypto';
import { nativeGzipAvailable, encodeGzipJson, decodeGzipJson } from './gzip';

// Local cache only. Remote commits/packs keep their existing encoding and hashes.
const magic = new Uint8Array([87, 76, 67, 65, 67, 72, 69]); // WLCACHE
const version = 1;

export async function encodeCache(value: unknown): Promise<Uint8Array> {
  if (!nativeGzipAvailable()) return encode(value);
  const compressed = await encodeGzipJson(value);
  return frameCacheGzip(compressed);
}

// Only for bytes produced by the shared gzip JSON encoder; cache framing remains independent of remote versions.
export function frameCacheGzip(compressed: Uint8Array): Uint8Array {
  const result = new Uint8Array(magic.length + 1 + compressed.length);
  result.set(magic);
  result[magic.length] = version;
  result.set(compressed, magic.length + 1);
  return result;
}

export async function decodeCache<T>(bytes: Uint8Array): Promise<T> {
  if (!magic.every((byte, index) => bytes[index] === byte)) return decode<T>(bytes);
  if (bytes[magic.length] !== version) throw new Error('Unsupported sync cache format.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Native sync cache decompression is unavailable.');
  try {
    return await decodeGzipJson<T>(bytes.subarray(magic.length + 1));
  } catch {
    // Native parser errors can include private text; expose only a fixed message.
    throw new Error('Invalid compressed sync cache.');
  }
}
