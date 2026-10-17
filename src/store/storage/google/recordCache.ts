import type { ContentInterface } from '@type/chat';
import { resolveContentStrict, type ContentStoreData } from '@utils/contentStore';
import { digest } from './crypto';

export interface ProjectedContent {
  readonly id: string;
  readonly value: string;
  readonly assets: Readonly<Record<string, string>>;
}

// Combined LRU budget: UTF-16 string bytes, excluding Map/object overhead.
export const RECORD_CACHE_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, { value: ProjectedContent | string; bytes: number }>();
let bytes = 0, generation = 0;
let contentHits = 0, contentMisses = 0, digestHits = 0, digestMisses = 0;

function lookup(key: string) {
  const entry = cache.get(key);
  if (entry) { cache.delete(key); cache.set(key, entry); }
  return entry?.value;
}

function remember(key: string, value: ProjectedContent | string) {
  const strings = typeof value === 'string' ? value.length : value.id.length + value.value.length +
    Object.entries(value.assets).reduce((total, [id, body]) => total + id.length + body.length, 0);
  const size = 2 * (key.length + strings);
  if (size > RECORD_CACHE_BYTES) return;
  const previous = cache.get(key);
  if (previous) { bytes -= previous.bytes; cache.delete(key); }
  while (bytes + size > RECORD_CACHE_BYTES) {
    const oldest = cache.keys().next().value!;
    bytes -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
  cache.set(key, { value, bytes: size });
  bytes += size;
}

export function clearRecordCaches() {
  cache.clear(); bytes = 0; generation++;
  contentHits = contentMisses = digestHits = digestMisses = 0;
}

export function getRecordCacheStats() {
  return { contentHits, contentMisses, digestHits, digestMisses, bytes, entries: cache.size };
}

/** Create once per immutable snapshot, never reuse after source mutation.
 * Value signatures validate the entire base chain each snapshot; local IDs and
 * object identity alone cannot establish that imported/in-place data is equal.
 */
export function createContentProjector(source: ContentStoreData, { cache: enabled = true } = {}) {
  const signatures = new Map<string, { value: string; depth: number }>();
  const signature = (hash: string) => {
    const path: { hash: string; segment: string }[] = [];
    const visited = new Set<string>();
    let current = hash;
    while (!signatures.has(current)) {
      const entry = source[current];
      if (!entry || visited.has(current) || path.length >= 100) {
        throw new Error('Missing, cyclic or excessively deep message content.');
      }
      visited.add(current);
      if (!entry.delta) {
        if (!Array.isArray(entry.content)) throw new Error('Invalid message content.');
        signatures.set(current, { value: JSON.stringify(['full', entry.content]), depth: 0 });
        break;
      }
      path.push({ hash: current, segment: JSON.stringify(['delta', entry.delta.baseHash, entry.delta.patches]) });
      current = entry.delta.baseHash;
    }
    let base = signatures.get(current)!;
    if (path.length + base.depth >= 100) throw new Error('Missing, cyclic or excessively deep message content.');
    for (const item of path.reverse()) {
      base = { value: `${item.segment}\n${base.value}`, depth: base.depth + 1 };
      signatures.set(item.hash, base);
    }
    return base.value;
  };
  return {
    async project(hash: string, build: (parts: ContentInterface[]) => Promise<ProjectedContent>): Promise<ProjectedContent> {
      const key = `content\n${signature(hash)}`;
      if (enabled) {
        const hit = lookup(key) as ProjectedContent | undefined;
        if (hit) { contentHits++; return hit; }
      }
      contentMisses++;
      const startedGeneration = generation;
      // A builder may normalize/mutate its input; never expose the source array.
      const built = await build(structuredClone(resolveContentStrict(source, hash)));
      const result = Object.freeze({ id: built.id, value: built.value, assets: Object.freeze({ ...built.assets }) });
      if (enabled && startedGeneration === generation) remember(key, result);
      return result;
    },
  };
}

export async function cachedRecordDigest(value: string, { cache: enabled = true } = {}) {
  // Large legacy message arrays must not evict the more expensive body projections.
  enabled = enabled && value.length <= 2048;
  const key = `digest\n${value}`;
  if (enabled) {
    const hit = lookup(key) as string | undefined;
    if (hit) { digestHits++; return hit; }
  }
  digestMisses++;
  const startedGeneration = generation;
  const result = await digest(value);
  if (enabled && startedGeneration === generation) remember(key, result);
  return result;
}
