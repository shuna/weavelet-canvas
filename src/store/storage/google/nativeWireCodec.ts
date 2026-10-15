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
const specialJsonValue = Symbol('special JSON value');

// Match JSON round-trip normalization without serializing/parsing all body strings.
// Only plain data properties take this path; custom JSON conversion/accessors keep
// the original normalization behavior. Containers are new, body strings are shared.
function normalizePlainJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'function' && 'toJSON' in value) throw specialJsonValue;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object') throw specialJsonValue;
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
      'toJSON' in value || ancestors.has(value)) throw specialJsonValue;
  ancestors.add(value);
  try {
    if (array) {
      const normalized: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const property = Object.getOwnPropertyDescriptor(value, String(i));
        if (property && !('value' in property) || !property && i in value) throw specialJsonValue;
        normalized.push(normalizePlainJson(property?.value, ancestors) ?? null);
      }
      return normalized;
    }
    const normalized: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !('value' in property)) throw specialJsonValue;
      const child = normalizePlainJson(property.value, ancestors);
      if (child !== undefined) normalized[key] = child;
    }
    return normalized;
  } finally { ancestors.delete(value); }
}

function canonicalCommit(commit: Commit): string {
  let normalized: unknown;
  try {
    normalized = normalizePlainJson(commit);
    if (normalized === undefined) throw specialJsonValue;
  }
  catch (error) {
    if (error !== specialJsonValue) throw error;
    normalized = JSON.parse(JSON.stringify(commit));
  }
  return canonical(normalized);
}

export async function hashNativeCommits(commits: Record<string, Commit>): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const [id, commit] of Object.entries(commits)) {
    // Normalize to JSON-safe values before canonicalization, matching the transmitted JSON semantics.
    hashes[id] = await digest(HASH_DOMAIN + canonicalCommit(commit));
  }
  return hashes;
}

export async function decodeNativeParts<T>(parts: Uint8Array[], maxBytes = NATIVE_WIRE_MAX_BYTES): Promise<{ bytes: Uint8Array; value: T }> {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, value: await decodeGzipJson<T>(bytes, maxBytes) };
}
