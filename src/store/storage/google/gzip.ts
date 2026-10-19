import { recordMetric } from './metrics';

export function nativeGzipAvailable(): boolean {
  try {
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return false;
    new CompressionStream('gzip'); new DecompressionStream('gzip');
    return true;
  } catch { return false; }
}

export function requireNativeGzip() {
  if (!nativeGzipAvailable()) throw new Error('Native sync gzip is unavailable.');
}

// Raw gzip JSON only. Callers own their independent cache header or remote manifest version.
export async function encodeGzipJson(value: unknown, maxBytes?: number): Promise<Uint8Array> {
  requireNativeGzip();
  const started = performance.now();
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Invalid native sync value.');
  const input = new TextEncoder().encode(json);
  if (maxBytes !== undefined && input.length > maxBytes) throw new Error('Native sync payload exceeds the byte limit.');
  recordMetric('serialize', started, input.length, input.length);
  const compressStarted = performance.now();
  const stream = new Blob([input.buffer]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  recordMetric('compress', compressStarted, input.length, bytes.length);
  return bytes;
}

export async function decodeGzipJson<T>(bytes: Uint8Array, maxBytes?: number): Promise<T> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Native sync gzip decompression is unavailable.');
  let exceeded = false;
  try {
    const owned = new Uint8Array(bytes);
    const stream = new Blob([owned.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    let output: ArrayBuffer | Uint8Array;
    if (maxBytes === undefined) output = await new Response(stream).arrayBuffer();
    else {
      const reader = stream.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            exceeded = true;
            await reader.cancel().catch(() => {});
            throw new Error();
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
      output = joined;
    }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(output);
    return JSON.parse(json) as T;
  } catch {
    // Native gzip and JSON errors can include private text.
    throw new Error(exceeded ? 'Native sync payload exceeds the byte limit.' : 'Invalid native sync gzip data.');
  }
}
