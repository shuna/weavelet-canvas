import { encode, decode } from '../source/crypto';
export const encodeAsync = async (value: unknown) => encode(value);
export const decodeAsync = async <T>(value: Uint8Array) => decode<T>(value);
export { encodeWire as encodeWireAsync, decodeWireParts as decodeWirePartsAsync } from '../../../src/store/storage/google/wire';
export { encodeCache as encodeCacheAsync, decodeCache as decodeCacheAsync } from '../../../src/store/storage/google/cacheCodec';
export { hashCommits as hashCommitsAsync } from '../source/replay';
export { toRecords as toRecordsAsync, fromRecords as fromRecordsAsync, hashRecords as hashRecordsAsync } from '../source/records';
export { collectHistory as collectHistoryAsync, replayHistory as replayHistoryAsync } from '../source/replay';
export const decodePartsAsync = async <T>(parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, value: decode<T>(bytes) };
};
