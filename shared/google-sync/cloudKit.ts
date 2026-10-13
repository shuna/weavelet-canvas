import { decompress } from 'lz-string';

// CloudKit BYTES stores the code units returned by lz-string compress() in little-endian order.
export const cloudKitCompressedToBytes = (compressed: string): Uint8Array => {
  const bytes = new Uint8Array(compressed.length * 2);
  for (let i = 0; i < compressed.length; i++) {
    const unit = compressed.charCodeAt(i);
    bytes[i * 2] = unit & 0xff;
    bytes[i * 2 + 1] = unit >>> 8;
  }
  return bytes;
};

export const cloudKitBytesToCompressed = (bytes: Uint8Array): string => {
  if (!bytes.length || bytes.length % 2) throw new Error('Invalid CloudKit payload.');
  let compressed = '';
  for (let i = 0; i < bytes.length; i += 2) {
    compressed += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return compressed;
};

export const cloudKitPayloadJSON = (bytes: Uint8Array): string => {
  const json = decompress(cloudKitBytesToCompressed(bytes));
  if (!json) throw new Error('Invalid CloudKit payload.');
  return json;
};

export const cloudKitSnapshotLayout = (
  value: unknown,
  legacyVersion: number
): { wrapped: boolean; version: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid CloudKit snapshot.');
  }
  if (!Object.hasOwn(value, 'state')) return { wrapped: false, version: legacyVersion };
  const snapshot = value as { state?: unknown; version?: unknown };
  if (!snapshot.state || typeof snapshot.state !== 'object' || Array.isArray(snapshot.state)) {
    throw new Error('Invalid CloudKit snapshot state.');
  }
  const version = snapshot.version == null ? 0 : Number(snapshot.version);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid CloudKit snapshot version.');
  return { wrapped: true, version };
};

export const cloudKitLocalWins = (localUpdatedAt: number, serverUpdatedAt?: number): boolean =>
  localUpdatedAt >= (serverUpdatedAt ?? 0);
