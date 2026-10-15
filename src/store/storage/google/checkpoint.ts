import { digest } from './crypto';
import { canonical, hashRecords, sameRecords, type Records } from './records';
import { hashNativeCommits, encodeNativeWire, decodeNativeParts } from './nativeWireCodec';
import { replayHistory, type Commit, type HistoryProgress } from './replay';

export interface Checkpoint {
  version: 1;
  commits: Record<string, string>;
  tips: string[];
  records: Records;
  conflicts: Record<string, (string | null)[]>;
  stateRoot: string;
}
export interface CheckpointKnownState { commits: Record<string, string>; tips: string[] }
type Progress = (progress: HistoryProgress) => void;
const hashPattern = /^[a-f0-9]{64}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && !forbidden.has(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && hashPattern.test(value);
function validRecordKey(key: string): boolean {
  try {
    const path: unknown = JSON.parse(key);
    return Array.isArray(path) && path.length > 0 && path.length <= 100 &&
      path.every(part => typeof part === 'string' && !forbidden.has(part));
  } catch { return false; }
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);

/** Record values are opaque JSON strings. Include conflicts so a checkpoint cannot erase a conflict. */
export async function recordRoot(records: Records, conflicts: Checkpoint['conflicts']): Promise<string> {
  // Hash opaque values separately, then bind their keys and conflicts. Avoid a second giant escaped body string.
  return digest('weavelet-sync-record-state:2\n' + canonical({ hashes: await hashRecords(records), conflicts }));
}

/** Shape/hash validation alone does NOT prove equivalence to history. Only verifyCheckpoint does that. */
export async function validateCheckpoint(value: unknown, known?: CheckpointKnownState): Promise<Checkpoint> {
  if (!object(value) || value.version !== 1 || !object(value.commits) ||
      Object.entries(value.commits).some(([id, hash]) => !validId(id) || !validHash(hash)) ||
      !Array.isArray(value.tips) || value.tips.some(id => !validId(id) || !Object.hasOwn(value.commits as object, id)) ||
      new Set(value.tips).size !== value.tips.length ||
      (Object.keys(value.commits).length === 0) !== (value.tips.length === 0) ||
      !object(value.records) || Object.entries(value.records).some(([key, item]) => !validRecordKey(key) || typeof item !== 'string') ||
      !object(value.conflicts) || Object.entries(value.conflicts).some(([key, items]) => !validRecordKey(key) ||
        !Array.isArray(items) || items.length < 2 || items.some(item => item !== null && !validHash(item)) || new Set(items).size !== items.length) ||
      !validHash(value.stateRoot)) throw new Error('Invalid sync checkpoint.');
  const source = value as unknown as Checkpoint;
  // Snapshot before awaiting a digest, so caller mutation cannot change the view being verified.
  const checkpoint: Checkpoint = { version: 1, commits: { ...source.commits }, tips: [...source.tips].sort(),
    records: { ...source.records }, conflicts: Object.fromEntries(Object.entries(source.conflicts).map(([key, items]) => [key, [...items]])),
    stateRoot: source.stateRoot };
  if (known && (!same(checkpoint.commits, known.commits) || !same([...checkpoint.tips].sort(), [...known.tips].sort()))) {
    throw new Error('Sync checkpoint history does not match.');
  }
  if (await recordRoot(checkpoint.records, checkpoint.conflicts) !== checkpoint.stateRoot) throw new Error('Damaged sync checkpoint state.');
  return checkpoint;
}

async function knownHistory(commits: Record<string, Commit>): Promise<CheckpointKnownState> {
  const ids = Object.keys(commits).sort();
  const parents = new Set<string>();
  const remaining = new Map<string, number>(), children = new Map<string, string[]>();
  for (const id of ids) {
    const commit = commits[id];
    if (!validId(id) || !commit || commit.version !== 1 || !Array.isArray(commit.parents) ||
        !Array.isArray(commit.changes) || commit.parents.some(parent => !validId(parent) || !Object.hasOwn(commits, parent))) {
      throw new Error('Invalid checkpoint source history.');
    }
    remaining.set(id, commit.parents.length);
    for (const parent of commit.parents) {
      parents.add(parent);
      const list = children.get(parent) ?? []; list.push(id); children.set(parent, list);
    }
  }
  const ready = ids.filter(id => !remaining.get(id));
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!; visited++;
    for (const child of children.get(id) ?? []) {
      const count = remaining.get(child)! - 1; remaining.set(child, count);
      if (!count) ready.push(child);
    }
  }
  if (visited !== ids.length) throw new Error('Cyclic checkpoint source history.');
  return { commits: await hashNativeCommits(Object.fromEntries(ids.map(id => [id, commits[id]]))), tips: ids.filter(id => !parents.has(id)) };
}

export async function createCheckpoint(commits: Record<string, Commit>, tips: string[], onProgress?: Progress): Promise<Checkpoint> {
  const known = await knownHistory(commits);
  if (new Set(tips).size !== tips.length || !same([...tips].sort(), known.tips)) throw new Error('Sync checkpoint tips do not match.');
  const { records, conflicts } = await replayHistory({ commits, tips: known.tips }, onProgress);
  return { version: 1, ...known, records, conflicts, stateRoot: await recordRoot(records, conflicts) };
}

/** First cloud use must replay the actual authenticated history, even when every body/root/hash looks valid. */
export async function verifyCheckpoint(value: unknown, commits: Record<string, Commit>, onProgress?: Progress): Promise<Checkpoint> {
  const known = await knownHistory(commits);
  const checkpoint = await validateCheckpoint(value, known);
  const replayed = await replayHistory({ commits, tips: known.tips }, onProgress);
  if (!sameRecords(checkpoint.records, replayed.records) || !same(checkpoint.conflicts, replayed.conflicts)) {
    throw new Error('Sync checkpoint differs from replayed history.');
  }
  return checkpoint;
}


export interface CheckpointSource { commits: Record<string, Commit>; tips: string[] }
export interface EncodedCheckpoint { payload: Uint8Array; stateRoot: string; commits: string[] }
export interface CompressedCheckpointVerification {
  chunks: Uint8Array[];
  commits: Record<string, Commit>;
  stateRoot: string;
  expectedCommitIds?: string[];
}

/** Keep the full replay and its encoding in one worker operation. Only compressed bytes cross back. */
export async function createEncodedCheckpoint(source: CheckpointSource, onProgress?: Progress): Promise<EncodedCheckpoint> {
  const checkpoint = await createCheckpoint(source.commits, source.tips, onProgress);
  return { payload: await encodeNativeWire(checkpoint), stateRoot: checkpoint.stateRoot,
    commits: Object.keys(checkpoint.commits) };
}

/** Decode and authenticate against retained source history before returning any checkpoint state. */
export async function decodeVerifyCheckpoint(input: CompressedCheckpointVerification, onProgress?: Progress): Promise<Checkpoint> {
  const { value } = await decodeNativeParts<unknown>(input.chunks);
  if (!object(value) || !object(value.commits) || value.stateRoot !== input.stateRoot) {
    throw new Error('Sync checkpoint publication mismatch.');
  }
  const ids = Object.keys(value.commits);
  if (input.expectedCommitIds && (new Set(input.expectedCommitIds).size !== input.expectedCommitIds.length ||
      !same([...ids].sort(), [...input.expectedCommitIds].sort()))) {
    throw new Error('Sync checkpoint source set mismatch.');
  }
  const commits = Object.fromEntries(ids.map(id => {
    if (!Object.hasOwn(input.commits, id)) throw new Error('Unknown checkpoint source history.');
    return [id, input.commits[id]];
  }));
  return verifyCheckpoint(value, commits, onProgress);
}
