import type { Change } from './records';
import type { Commit } from './replay';

export type CompressionPayload = Commit | { version: 1; commits: Record<string, Commit> };
type BodyReference = { body: number };
type MetadataChange = Omit<Change, 'after'> & { after: string | null | BodyReference };
type MetadataCommit = Omit<Commit, 'changes'> & { changes: MetadataChange[] };
type MetadataPayload = MetadataCommit | { version: 1; commits: Record<string, MetadataCommit> };
export interface CompressionPartition {
  format: 'weavelet-sync-partition-bench';
  version: 1;
  metadata: MetadataPayload;
  bodies: string[];
}

const format = 'weavelet-sync-partition-bench';
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function changes(payload: MetadataPayload): MetadataChange[] {
  if (!payload || payload.version !== 1 || typeof payload !== 'object') throw new Error('Invalid compression benchmark payload.');
  const commits = Object.hasOwn(payload, 'commits') ? (payload as { commits: Record<string, MetadataCommit> }).commits : undefined;
  if (Object.hasOwn(payload, 'commits') && (!commits || typeof commits !== 'object' || Array.isArray(commits))) {
    throw new Error('Invalid compression benchmark pack.');
  }
  const result: MetadataChange[] = [];
  for (const commit of commits === undefined ? [payload as MetadataCommit] : Object.values(commits)) {
    if (!commit || commit.version !== 1 || !Array.isArray(commit.parents) ||
        commit.parents.some(id => typeof id !== 'string') || !Array.isArray(commit.changes)) {
      throw new Error('Invalid compression benchmark commit.');
    }
    for (const change of commit.changes) {
      if (!change || typeof change.key !== 'string' || !(change.before === null || typeof change.before === 'string')) {
        throw new Error('Invalid compression benchmark change.');
      }
      result.push(change);
    }
  }
  return result;
}

function bodyKind(key: string): 'content' | 'assets' | 'legacyMessages' | undefined {
  const path: unknown = JSON.parse(key);
  if (!Array.isArray(path) || !path.length || path.some(part => typeof part !== 'string')) {
    throw new Error('Invalid compression benchmark record path.');
  }
  // Paths are inspected as strings, never expanded into objects (including __proto__/constructor segments).
  if (path.length === 2 && (path[0] === 'content' || path[0] === 'assets')) return path[0];
  if (path.length === 3 && path[0] === 'chats' && path[2] === 'messages') return 'legacyMessages';
}

/** Benchmark-only coarse record partition. Legacy message role/type and other inline fields stay in the body section.
 * String-valued Change.after contents remain opaque: their JSON spelling, whitespace and Unicode are never rewritten.
 */
export function partitionCompression(payload: CompressionPayload): CompressionPartition {
  const metadata = cloneJson(payload), bodies: string[] = [];
  for (const change of changes(metadata)) {
    const kind = bodyKind(change.key);
    if (!(change.after === null || typeof change.after === 'string')) throw new Error('Invalid compression benchmark value.');
    if (kind && change.after !== null) {
      const index = bodies.length;
      bodies.push(change.after);
      change.after = { body: index };
    }
  }
  return { format, version: 1, metadata, bodies };
}

export function restoreCompression(partition: CompressionPartition): CompressionPayload {
  if (!partition || partition.format !== format || partition.version !== 1 ||
      !Array.isArray(partition.bodies) || partition.bodies.some(value => typeof value !== 'string')) {
    throw new Error('Invalid compression benchmark partition.');
  }
  const restored = cloneJson(partition.metadata), used = new Set<number>();
  for (const change of changes(restored)) {
    const kind = bodyKind(change.key), reference = change.after;
    if (reference === null) continue; // Deletions are metadata, including deleted body records.
    if (typeof reference === 'string') {
      if (kind) throw new Error('Unpartitioned compression benchmark body.');
      continue;
    }
    if (!kind || !reference || Array.isArray(reference) || Object.keys(reference).join(',') !== 'body' ||
        !Number.isSafeInteger(reference.body) || reference.body < 0 || reference.body >= partition.bodies.length || used.has(reference.body)) {
      throw new Error('Invalid compression benchmark body reference.');
    }
    used.add(reference.body);
    change.after = partition.bodies[reference.body];
  }
  if (used.size !== partition.bodies.length) throw new Error('Unused compression benchmark body.');
  return restored as CompressionPayload;
}

export function compressionPartitionStats(partition: CompressionPartition) {
  const logical = restoreCompression(partition);
  const kinds = { content: 0, assets: 0, legacyMessages: 0 };
  let recordCount = 0, bodyReferenceJsonBytes = 0;
  for (const change of changes(partition.metadata)) {
    recordCount++;
    if (change.after !== null && typeof change.after === 'object') {
      kinds[bodyKind(change.key)!]++;
      bodyReferenceJsonBytes += byteLength(JSON.stringify(change.after));
    }
  }
  const metadataJsonBytes = byteLength(JSON.stringify(partition.metadata));
  const bodyJsonBytes = byteLength(JSON.stringify(partition.bodies));
  const jsonTotalBytes = byteLength(JSON.stringify(partition));
  return {
    recordCount, bodyRecordCount: partition.bodies.length, metadataRecordCount: recordCount - partition.bodies.length,
    contentRecordCount: kinds.content, assetRecordCount: kinds.assets, legacyBodyRecordCount: kinds.legacyMessages,
    bodyValueUtf8Bytes: partition.bodies.reduce((total, body) => total + byteLength(body), 0),
    logicalJsonBytes: byteLength(JSON.stringify(logical)), metadataJsonBytes, bodyJsonBytes, bodyReferenceJsonBytes,
    // JSON wrapper overhead only. A benchmark's separate binary framing (e.g. 20 bytes) must be accounted independently.
    jsonWrapperBytes: jsonTotalBytes - metadataJsonBytes - bodyJsonBytes, jsonTotalBytes,
    legacyInlineFieldsRemainInBody: true,
  };
}
