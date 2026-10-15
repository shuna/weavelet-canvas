import { canonical } from './records';
import { digest } from './crypto';
import { decodeGzipJson, encodeGzipJson } from './gzip';
import type { Commit } from './replay';

// Experimental per-payload processing bound, not history retention or a bound on total process memory.
// Writers and readers share it so a successfully published native payload remains readable.
// ponytail: whole JSON payloads cap at 256 MiB; split before compression for larger datasets.
export const NATIVE_WIRE_MAX_BYTES = 256 * 1024 * 1024;
export const encodeNativeWire = (value: unknown, maxBytes = NATIVE_WIRE_MAX_BYTES) => encodeGzipJson(value, maxBytes);

// Pack manifest version 3 selects this rule; legacy pack hashes remain digest(encode(commit)).
const HASH_DOMAIN = 'weavelet-sync-commit:2\n';
export async function hashNativeCommits(commits: Record<string, Commit>): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const [id, commit] of Object.entries(commits)) {
    // Normalize to JSON-safe values before canonicalization, matching the transmitted JSON semantics.
    hashes[id] = await digest(HASH_DOMAIN + canonical(JSON.parse(JSON.stringify(commit))));
  }
  return hashes;
}

export async function decodeNativeParts<T>(parts: Uint8Array[], maxBytes = NATIVE_WIRE_MAX_BYTES): Promise<{ bytes: Uint8Array; value: T }> {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, value: await decodeGzipJson<T>(bytes, maxBytes) };
}
