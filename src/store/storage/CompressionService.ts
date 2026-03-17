/**
 * CompressionService — Copy-on-Write gzip compression for inactive chats.
 *
 * State transitions:
 *   [raw] → compressChat → [packed only]
 *   [packed only] → decompressChat → [raw]
 *
 * Safety: raw is deleted only after packed write succeeds (separate transactions).
 * On read, raw takes priority over packed (raw-first rule).
 */

const PACKED_SUFFIX = ':packed';

export const packedKey = (chatKey: string): string => `${chatKey}${PACKED_SUFFIX}`;
export const isPackedKey = (key: string): boolean => key.endsWith(PACKED_SUFFIX);

// ─── Feature detection ───

let _compressionSupported: boolean | null = null;

export function isCompressionSupported(): boolean {
  if (_compressionSupported !== null) return _compressionSupported;
  try {
    _compressionSupported =
      typeof CompressionStream !== 'undefined' &&
      typeof DecompressionStream !== 'undefined';
  } catch {
    _compressionSupported = false;
  }
  return _compressionSupported;
}

// ─── Low-level gzip helpers ───

export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.byteLength;
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.byteLength;
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// ─── Serialize / deserialize chat records ───

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function compressChatRecord(record: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(record);
  const raw = encoder.encode(json);
  return gzipCompress(raw);
}

export async function decompressChatRecord<T>(compressed: Uint8Array): Promise<T> {
  const raw = await gzipDecompress(compressed);
  const json = decoder.decode(raw);
  return JSON.parse(json) as T;
}
