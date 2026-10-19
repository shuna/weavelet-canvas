import { encrypt, decrypt } from './crypto';
import { readSyncEntries, writeSyncCache } from './cache';

const PART_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export interface CompressionTransportMeasurement {
  encryptMs: number;
  decryptMs: number;
  writeMs: number;
  readMs: number;
  ciphertextBytes: number;
  payloadCiphertextBytes: number;
  manifestPlainBytes: number;
  manifestCiphertextBytes: number;
  parts: number;
  fileCount: number;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/** Benchmark only: call from an isolated browser profile/origin, never the user's app session.
 * This common uncompressed JSON manifest is not a production sync manifest.
 * Key generation, framing, exact verification and cleanup are outside the four reported timings.
 * No sessions or remembered keys are saved; only this call's random dataset entries are removed.
 * Inline controls accept 1 byte through 1 MiB and omit the benchmark manifest.
 * Default mode also accepts an empty frame, represented by its manifest alone.
 */
export async function measureCompressionTransport(frame: Uint8Array, { inline = false }: { inline?: boolean } = {}): Promise<CompressionTransportMeasurement> {
  if (inline && (!frame.length || frame.length > PART_BYTES)) {
    throw new Error('Inline benchmark payload must contain 1 to 1048576 bytes.');
  }
  const dataset = `compression-transport-bench:${crypto.randomUUID()}`;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const parts = Math.ceil(frame.byteLength / PART_BYTES);
  const partIds = Array.from({ length: parts }, (_, i) => `part:${i}`);
  const keys = inline ? partIds : [...partIds, 'manifest'];
  const manifest = inline ? undefined : encoder.encode(JSON.stringify({ format: 'weavelet-compression-transport-bench', version: 1,
    partBytes: PART_BYTES, frameBytes: frame.byteLength, parts: partIds }));
  const entries: [string, Uint8Array][] = [];
  try {
    let started = performance.now();
    for (let i = 0; i < parts; i++) entries.push([partIds[i], await encrypt(key,
      frame.subarray(i * PART_BYTES, (i + 1) * PART_BYTES), `${dataset}:${partIds[i]}`)]);
    const payloadCiphertextBytes = entries.reduce((total, [, bytes]) => total + bytes.length, 0);
    const encryptedManifest = manifest ? await encrypt(key, manifest, `${dataset}:manifest`) : undefined;
    const encryptMs = performance.now() - started;
    if (encryptedManifest) entries.push(['manifest', encryptedManifest]);
    started = performance.now();
    await writeSyncCache(dataset, undefined, entries);
    const writeMs = performance.now() - started;
    started = performance.now();
    const stored = await readSyncEntries(dataset, keys);
    const readMs = performance.now() - started;
    if (stored.some(bytes => !bytes)) throw new Error('Missing compression benchmark transport entry.');
    let decryptMs = 0, offset = 0;
    const restored = new Uint8Array(frame.byteLength);
    for (let i = 0; i < keys.length; i++) {
      started = performance.now();
      const bytes = await decrypt(key, stored[i]!, `${dataset}:${keys[i]}`);
      decryptMs += performance.now() - started;
      if (manifest && i === parts) {
        if (!equalBytes(bytes, manifest)) throw new Error('Compression benchmark manifest mismatch.');
      } else {
        restored.set(bytes, offset);
        offset += bytes.length;
      }
    }
    if (offset !== frame.length || !equalBytes(restored, frame)) throw new Error('Compression benchmark transport mismatch.');
    return { encryptMs, decryptMs, writeMs, readMs,
      ciphertextBytes: payloadCiphertextBytes + (encryptedManifest?.length ?? 0),
      payloadCiphertextBytes, manifestPlainBytes: manifest?.length ?? 0, manifestCiphertextBytes: encryptedManifest?.length ?? 0,
      parts, fileCount: entries.length };
  } finally {
    await writeSyncCache(dataset, undefined, [], keys);
  }
}
