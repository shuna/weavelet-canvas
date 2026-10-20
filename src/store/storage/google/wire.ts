import DiffMatchPatch from 'diff-match-patch';
import { decode, digest, encode } from './crypto';
import type { Commit } from './replay';

type Payload = Commit | { version: 1; commits: Record<string, Commit> };
export async function decodeWireParts<T>(parts: Uint8Array[]): Promise<{ bytes: Uint8Array; value: T }> {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, value: await decodeWire<T>(bytes) };
}
type Delta = { base: string; patches: string; hash: string };
type WireChange = { key: string; before: string | null; after: string | null | Delta };
const FORMAT = 'weavelet-sync-delta';
const dmp = new DiffMatchPatch();
// Bound diff work per candidate; an unfinished diff simply loses the size comparison.
dmp.Diff_Timeout = 0.1;

function contentHash(key: string): string | undefined {
  try {
    const path: unknown = JSON.parse(key);
    if (Array.isArray(path) && path.length === 2 && path[0] === 'content' &&
        typeof path[1] === 'string' && /^[a-f0-9]{64}$/.test(path[1])) return path[1];
  } catch { /* Other records are never delta candidates. */ }
}

function textParts(value: string): boolean {
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length > 0 && parts.every(part =>
      part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string');
  } catch { return false; }
}

function changes(value: unknown): WireChange[] {
  if (!value || typeof value !== 'object' || (value as any).version !== 1) throw new Error('Invalid sync delta payload.');
  const payload = value as any;
  const commits = Object.hasOwn(payload, 'commits') ? payload.commits : undefined;
  if (commits !== undefined && (!commits || typeof commits !== 'object' || Array.isArray(commits))) {
    throw new Error('Invalid sync delta pack.');
  }
  const result: WireChange[] = [];
  for (const commit of commits === undefined ? [payload] : Object.values(commits) as any[]) {
    if (!commit || commit.version !== 1 || !Array.isArray(commit.parents) ||
        commit.parents.some((id: unknown) => typeof id !== 'string') || !Array.isArray(commit.changes)) {
      throw new Error('Invalid sync delta commit.');
    }
    for (const change of commit.changes) {
      if (!change || typeof change.key !== 'string' || !(change.before === null || typeof change.before === 'string') ||
          !(change.after === null || typeof change.after === 'string' || (change.after && typeof change.after === 'object'))) {
        throw new Error('Invalid sync delta change.');
      }
      result.push(change);
    }
  }
  return result;
}

// Callers may reuse their already encoded logical payload; it must encode this exact value.
export async function encodeWire(value: Payload, full: Uint8Array = encode(value)): Promise<Uint8Array> {
  const copy = structuredClone(value);
  const bases: { key: string; text: string }[] = [];
  let replaced = false;
  for (const change of changes(copy)) {
    const hash = contentHash(change.key);
    if (!hash || typeof change.after !== 'string' || !textParts(change.after) || await digest(change.after) !== hash) continue;
    let best: Delta | undefined;
    for (const base of bases) {
      if (base.key === change.key) continue;
      const patches = dmp.patch_toText(dmp.patch_make(base.text, change.after));
      if (patches.length < change.after.length * 0.7 && (!best || patches.length < best.patches.length)) {
        best = { base: base.key, patches, hash };
      }
    }
    if (best) { change.after = best; replaced = true; }
    else {
      // ponytail: compare only four nearby complete bodies; add a similarity index only after measurement.
      bases.push({ key: change.key, text: change.after });
      if (bases.length > 4) bases.shift();
    }
  }
  if (!replaced) return full;
  // Repeated text already compresses well. Choose on actual compressed bytes, including the wrapper.
  const delta = encode({ format: FORMAT, version: 1, value: copy });
  return delta.length < full.length ? delta : full;
}

export async function decodeWire<T>(bytes: Uint8Array): Promise<T> {
  const decoded = decode<any>(bytes);
  if (!decoded || typeof decoded !== 'object' || !Object.hasOwn(decoded, 'format')) return decoded as T;
  if (decoded.format !== FORMAT || decoded.version !== 1) throw new Error('Unsupported sync delta format.');
  const entries = changes(decoded.value);
  const bases = new Map<string, string>();
  for (const change of entries) {
    if (!contentHash(change.key) || typeof change.after !== 'string') continue;
    const previous = bases.get(change.key);
    if (previous !== undefined && previous !== change.after) throw new Error('Conflicting sync delta bases.');
    bases.set(change.key, change.after);
  }
  const verifiedBases = new Set<string>();
  for (const change of entries) {
    if (change.after === null || typeof change.after === 'string') continue;
    const delta = change.after, hash = contentHash(change.key);
    if (!hash || Array.isArray(delta) || Object.keys(delta).sort().join(',') !== 'base,hash,patches' ||
        delta.hash !== hash || typeof delta.base !== 'string' || typeof delta.patches !== 'string' || delta.base === change.key) {
      throw new Error('Invalid sync content delta.');
    }
    // Only complete strings from this payload qualify: no downloads, chains or cycles.
    const base = bases.get(delta.base), baseHash = contentHash(delta.base);
    if (base === undefined || !baseHash) throw new Error('Missing complete sync delta base.');
    if (!verifiedBases.has(delta.base)) {
      if (!textParts(base) || await digest(base) !== baseHash) throw new Error('Damaged sync delta base.');
      verifiedBases.add(delta.base);
    }
    try {
      const [restored, applied] = dmp.patch_apply(dmp.patch_fromText(delta.patches), base);
      if (applied.some((ok: boolean) => !ok) || !textParts(restored) || await digest(restored) !== hash) {
        throw new Error();
      }
      // Preserve the exact original JSON string, including property order, for commit authentication.
      change.after = restored;
    } catch {
      // Parser exceptions can include message text from the patch.
      throw new Error('Damaged sync content delta.');
    }
  }
  return decoded.value as T;
}
