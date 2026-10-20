import { ContentInterface } from '@type/chat';
import {
  getStreamingTargetFromHash,
  isStreamingContentHash,
  peekBufferedContent,
} from './streamingBuffer';
import { diff_match_patch } from 'diff-match-patch';

const dmp = new diff_match_patch();

/**
 * ContentStore: content-addressable storage for message content.
 * Maps contentHash → { content, refCount }.
 * Used to deduplicate identical message bodies across conversations and branches.
 *
 * Supports delta compression: when a new entry is similar to an existing one,
 * only the diff (patch) is stored instead of the full content.
 */

export interface ContentEntry {
  content: ContentInterface[];
  refCount: number;
  delta?: {
    baseHash: string;          // contentHash of the delta base
    patches: string;           // diff-match-patch patch_toText format
  };
  // content and delta are exclusive:
  //   - no delta → content has full data
  //   - delta present → content is empty array, resolve via baseHash + patches
}

export type ContentStoreData = Record<string, ContentEntry>;

/** Maximum delta chain depth before forcing full storage */
const MAX_CHAIN_DEPTH = 5;
// Read legacy chains without applying the stricter limit used when creating deltas.
const MAX_RESOLVE_DEPTH = 100;

/**
 * Pending GC: hashes with refCount <= 0 that have been promoted but not yet
 * deleted from the store. Actual deletion is deferred to saveChatData so that
 * buildSupersetForCommit can include them in the superset for crash safety.
 *
 * Entries remain in the store (with refCount <= 0) until flushPendingGC is called.
 */
const pendingGCHashes = new Set<string>();

export function getPendingGCHashes(): ReadonlySet<string> {
  return pendingGCHashes;
}

/**
 * Actually remove pending GC entries from the in-memory store.
 * Called after the commit protocol completes successfully.
 */
export function flushPendingGC(
  store: ContentStoreData,
  protectedHashes: ReadonlySet<string> = new Set()
): string[] {
  const flushed: string[] = [];
  // A new delta may have reused a pending base since releaseContent ran.
  const deltaBases = new Set(Object.values(store).flatMap(entry => entry.delta ? [entry.delta.baseHash] : []));
  for (const hash of pendingGCHashes) {
    if (deltaBases.has(hash)) continue;
    if (protectedHashes.has(hash)) {
      // Reference counts are an optimization and can drift after interrupted
      // or legacy operations. A live branch reference is authoritative.
      if (store[hash] && store[hash].refCount <= 0) {
        store[hash].refCount = 1;
      }
      continue;
    }
    if (store[hash] && store[hash].refCount <= 0) {
      delete store[hash];
      flushed.push(hash);
    }
  }
  pendingGCHashes.clear();
  return flushed;
}

/** If patch size / original text size > this, store full content instead */
const DELTA_SIZE_THRESHOLD = 0.7;

/**
 * Check if content is eligible for delta compression (text-only, no images).
 */
export function isDeltaEligible(content: ContentInterface[]): boolean {
  return content.length > 0 && content.every((c) => c.type === 'text');
}

/**
 * Compute a fast hash of ContentInterface[].
 * Uses FNV-1a for speed; collisions are acceptable because we verify on lookup.
 */
export function computeContentHash(content: ContentInterface[]): string {
  const str = JSON.stringify(content);
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Get the delta chain depth for a given hash.
 * Returns 0 for full entries, 1+ for delta entries.
 */
export function getChainDepth(store: ContentStoreData, hash: string): number {
  let depth = 0;
  let current = hash;
  const visited = new Set<string>();
  while (store[current]?.delta) {
    if (visited.has(current)) return MAX_CHAIN_DEPTH + 1; // circular
    visited.add(current);
    depth++;
    current = store[current].delta!.baseHash;
  }
  return depth;
}

/**
 * Concatenate all text content into a single string for diffing.
 */
function contentToText(content: ContentInterface[]): string {
  return JSON.stringify(content);
}

/**
 * Add content to the store. Returns the hash.
 * If content with same hash already exists, increments refCount.
 */
export function addContent(
  store: ContentStoreData,
  content: ContentInterface[]
): string {
  let hash = computeContentHash(content);
  const serialized = JSON.stringify(content);
  // Handle hash collisions: if the stored content differs, append a suffix
  while (store[hash] && !isContentMatch(store, hash, serialized)) {
    hash += '_';
  }
  if (store[hash]) {
    store[hash].refCount++;
  } else {
    store[hash] = { content, refCount: 1 };
  }
  return hash;
}

/**
 * Check if a stored entry (possibly delta) matches the given serialized content.
 */
function isContentMatch(
  store: ContentStoreData,
  hash: string,
  serialized: string
): boolean {
  const entry = store[hash];
  if (!entry) return false;
  if (entry.delta) {
    // Resolve delta to compare
    const resolved = resolveContentStrict(store, hash);
    return JSON.stringify(resolved) === serialized;
  }
  return JSON.stringify(entry.content) === serialized;
}

/**
 * Add content as a delta against baseHash if beneficial.
 * Falls back to full storage when delta is not worthwhile.
 * Returns the hash.
 */
export function addContentDelta(
  store: ContentStoreData,
  content: ContentInterface[],
  baseHash: string
): string {
  // Pre-checks: base must exist and content must be delta-eligible
  const baseEntry = store[baseHash];
  if (!baseEntry) return addContent(store, content);

  // Both must be text-only
  if (!isDeltaEligible(content)) return addContent(store, content);

  const baseContent = resolveContentStrict(store, baseHash);
  if (!isDeltaEligible(baseContent)) return addContent(store, content);

  // Check chain depth
  if (getChainDepth(store, baseHash) >= MAX_CHAIN_DEPTH - 1) {
    return addContent(store, content);
  }

  // Compute hash first to check for duplicates
  let hash = computeContentHash(content);
  const serialized = JSON.stringify(content);

  while (store[hash] && !isContentMatch(store, hash, serialized)) {
    hash += '_';
  }
  if (store[hash]) {
    store[hash].refCount++;
    return hash;
  }

  // Compute diff
  const baseText = contentToText(baseContent);
  const newText = contentToText(content);
  const patches = dmp.patch_make(baseText, newText);
  const patchText = dmp.patch_toText(patches);

  // Check if delta is worthwhile: patch must be smaller than full content
  if (patchText.length >= newText.length * DELTA_SIZE_THRESHOLD) {
    store[hash] = { content, refCount: 1 };
    return hash;
  }

  // Store as delta
  store[hash] = {
    content: [],
    refCount: 1,
    delta: {
      baseHash,
      patches: patchText,
    },
  };
  return hash;
}

/**
 * Increment the reference count for a given hash.
 */
export function retainContent(store: ContentStoreData, hash: string): void {
  if (isStreamingContentHash(hash)) return;
  if (store[hash]) {
    store[hash].refCount++;
  }
}

/**
 * Promote a delta entry to full content.
 */
export function promoteToFull(store: ContentStoreData, hash: string): void {
  const entry = store[hash];
  if (!entry?.delta) return;
  const resolved = resolveContentStrict(store, hash);
  entry.content = resolved;
  delete entry.delta;
}

/**
 * Promote all entries that depend on baseHash to full content.
 * Called when baseHash is about to be deleted.
 */
export function promoteDependents(
  store: ContentStoreData,
  baseHash: string
): void {
  // Resolve every dependent before changing any entry: a corrupt sibling must
  // not leave the store half promoted or permit the base to be collected.
  const resolved = Object.entries(store)
    .filter(([, entry]) => entry.delta?.baseHash === baseHash)
    .map(([hash, entry]) => ({ entry, content: resolveContentStrict(store, hash) }));
  for (const { entry, content } of resolved) {
    entry.content = content;
    delete entry.delta;
  }
}

/**
 * Decrement refCount. If it reaches 0, promote dependents and mark for
 * deferred GC. The entry is NOT deleted from the store immediately —
 * it remains available so that buildSupersetForCommit can include it
 * in the superset for crash safety. Actual deletion happens when
 * flushPendingGC is called after a successful commit.
 */
export function releaseContent(store: ContentStoreData, hash: string): void {
  if (isStreamingContentHash(hash)) return;
  if (!store[hash]) return;
  if (store[hash].refCount <= 1) {
    promoteDependents(store, hash);
    pendingGCHashes.add(hash);
    // Entry stays in store until flushPendingGC
  }
  store[hash].refCount--;
}

/**
 * Resolve a contentHash to actual content.
 * Display reads tolerate corrupt delta chains; strict reads throw instead.
 */
export function resolveContent(
  store: ContentStoreData,
  hash: string
): ContentInterface[] {
  if (isStreamingContentHash(hash)) {
    const target = getStreamingTargetFromHash(hash);
    return target ? peekBufferedContent(target.chatId, target.nodeId) ?? [] : [];
  }
  try {
    return resolveContentStrict(store, hash);
  } catch {
    // Display reads tolerate damaged data; persistence must use the strict resolver.
    return [];
  }
}

// Keep the final patch text available at the raw native I/O boundary.
export function resolveDeltaContentJSON(store: ContentStoreData, hash: string): string | null {
  try {
    const resolved = resolveStoredContent(store, hash);
    return resolved.text ?? contentToText(resolved.content);
  } catch {
    return null;
  }
}

/** Resolve stored content without turning corruption into a valid empty message. */
export function resolveContentStrict(store: ContentStoreData, hash: string): ContentInterface[] {
  return resolveStoredContent(store, hash).content;
}

function resolveStoredContent(store: ContentStoreData, hash: string): { content: ContentInterface[]; text?: string } {
  const visited = new Set<string>();
  const chain: string[] = [];
  let current = hash;
  while (true) {
    const entry = store[current];
    if (!entry || visited.has(current) || chain.length >= MAX_RESOLVE_DEPTH) {
      throw new Error('Missing, cyclic or excessively deep message content.');
    }
    if (!entry.delta) break;
    visited.add(current);
    chain.push(entry.delta.patches);
    current = entry.delta.baseHash;
  }
  const base = store[current].content;
  if (!Array.isArray(base)) throw new Error('Invalid message content.');
  if (!chain.length) return { content: base };
  try {
    let content = base;
    let text = contentToText(base);
    for (const patchText of chain.reverse()) {
      const [result, applied] = dmp.patch_apply(dmp.patch_fromText(patchText), text);
      if (applied.some((ok: boolean) => !ok)) throw new Error();
      const resolved: unknown = JSON.parse(result);
      if (!Array.isArray(resolved)) throw new Error();
      content = resolved as ContentInterface[];
      text = result;
    }
    return { content, text };
  } catch {
    // Patch parser errors can contain message text; never expose their raw errors.
    throw new Error('Invalid message delta.');
  }
}

/**
 * Check if stored content at the given hash equals the provided content.
 * Uses strict resolution to avoid mistaking corrupt data for an empty message.
 * Safer than comparing computeContentHash directly because stored hashes
 * may have collision-avoidance suffixes (see addContent).
 */
export function isContentEqual(
  store: ContentStoreData,
  hash: string,
  content: ContentInterface[]
): boolean {
  const resolved = isStreamingContentHash(hash) ? resolveContent(store, hash) : resolveContentStrict(store, hash);
  return JSON.stringify(resolved) === JSON.stringify(content);
}

/**
 * Resolve a contentHash to plain text (all text content joined).
 * Useful for search and preview — follows delta chains via resolveContent.
 */
export function resolveContentText(
  store: ContentStoreData,
  hash: string
): string {
  const content = resolveContent(store, hash);
  return content
    .filter((c): c is Extract<ContentInterface, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text)
    .join(' ');
}

/**
 * Build an export-safe content store with all deltas resolved to full content.
 * Ensures V3 format compatibility.
 */
export function buildExportContentStore(
  store: ContentStoreData
): ContentStoreData {
  const exported: ContentStoreData = {};
  for (const [hash, entry] of Object.entries(store)) {
    const { delta: _delta, ...fullEntry } = entry;
    exported[hash] = { ...fullEntry, content: resolveContentStrict(store, hash) };
  }
  return exported;
}

/**
 * Validate all delta entries at startup. Logs warnings for corruption but does
 * NOT erase or overwrite entries — resolveContent already handles unresolvable
 * deltas gracefully (returns []), so destructive repair at boot is unnecessary
 * and would cause permanent data loss if the corruption is transient.
 *
 * Checks: missing base, circular chains, patch parse/apply failures.
 * Returns the set of corrupt hashes for diagnostic purposes.
 */
export function validateDeltaIntegrity(store: ContentStoreData): Set<string> {
  const corrupt = new Set<string>();

  for (const [hash, entry] of Object.entries(store)) {
    if (!entry.delta) continue;
    try {
      resolveContentStrict(store, hash);
    } catch {
      console.warn(`[ContentStore] Invalid delta chain at ${hash}`);
      corrupt.add(hash);
    }
  }

  if (corrupt.size > 0) {
    console.warn(
      `[ContentStore] ${corrupt.size} corrupt delta(s) detected at startup. ` +
      `Affected hashes will return empty content on read.`
    );
  }

  return corrupt;
}
