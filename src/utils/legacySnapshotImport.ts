import { inspectLegacySnapshotContainer } from './legacySnapshotContainer';

export async function readLegacySnapshotImport(file: Blob): Promise<string> {
  const header = new Uint8Array(await file.slice(0, 20).arrayBuffer());
  const container = inspectLegacySnapshotContainer(Array.from(header), file.size);
  if (!container) throw new Error('Invalid old iOS container magic');
  const { decompressZstd } = await import('../../shared/zstd');
  const payload = new Uint8Array(await file.slice(20).arrayBuffer());
  const json = await decompressZstd(payload, container.uncompressedSize);
  return new TextDecoder('utf-8', { fatal: true }).decode(json);
}
