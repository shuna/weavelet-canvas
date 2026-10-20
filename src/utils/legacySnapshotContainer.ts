export const LEGACY_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;

// SnapshotContainer.swift writes UInt32LE 0x57564c54: the actual bytes are TLVW.
export function inspectLegacySnapshotContainer(header: readonly number[], totalLength: number): { uncompressedSize: number; compressedSize: number } | null {
  if (header[0] !== 0x54 || header[1] !== 0x4c || header[2] !== 0x56 || header[3] !== 0x57) return null;
  if (header.length < 20 || header.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Invalid old iOS container header');
  const u32 = (offset: number) => header[offset] + header[offset + 1] * 256 + header[offset + 2] * 65536 + header[offset + 3] * 16777216;
  if (header[4] !== 1 || header[5] !== 0 || header[6] !== 1 || u32(16) !== 0) throw new Error('Unsupported old iOS container');
  const uncompressedSize = u32(8), compressedSize = u32(12);
  if (!uncompressedSize || uncompressedSize > LEGACY_SNAPSHOT_MAX_BYTES || !compressedSize || compressedSize > LEGACY_SNAPSHOT_MAX_BYTES || totalLength !== 20 + compressedSize) throw new Error('Invalid old iOS container size');
  return { uncompressedSize, compressedSize };
}
