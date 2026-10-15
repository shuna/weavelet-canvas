import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as processing from '../google/processing';
import * as storage from '../google/cache';
import { decodeCache } from '../google/cacheCodec';
import { decode, decrypt, digest, encode, encrypt } from '../google/crypto';
import { decodeNativeParts, encodeNativeWire } from '../google/nativeWireCodec';
import { createCheckpoint, recordRoot, type Checkpoint } from '../google/checkpoint';
import type { Snapshot } from '../google/records';
import type { Commit } from '../google/replay';
import { EncryptedSync } from './EncryptedSync';
import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from './transport';

class CheckpointTransport implements SyncTransport {
  next = 0;
  headers = new Map<string, string>();
  files = new Map<string, { dataset: string; kind: string; bytes: Uint8Array }>();
  events: SyncChange[] = [];
  writes: { id: string; kind: string }[] = [];
  async ids(count: number) { return Array.from({ length: count }, () => `checkpoint-test-${++this.next}`); }
  async folder(id: string, header: string) { this.headers.set(id, header); return { id }; }
  async keyHeader(dataset: string) {
    const id = this.headers.get(dataset);
    if (!id) throw new SyncFileNotFoundError('Missing dataset.');
    return id;
  }
  async read(id: string) {
    const entry = this.files.get(id);
    if (!entry) throw new SyncFileNotFoundError('Missing file.');
    return entry.bytes.slice();
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
    const existing = this.files.get(id);
    if (existing) { expect(existing.bytes).toEqual(bytes); return; }
    this.files.set(id, { dataset, kind, bytes: bytes.slice() });
    this.events.push({ id, dataset, kind });
    this.writes.push({ id, kind });
  }
  async startToken() { return String(this.events.length); }
  private list(dataset: string, kind: string) {
    return [...this.files].filter(([, file]) => file.dataset === dataset && file.kind === kind).map(([id]) => id);
  }
  async history(dataset: string) { return { commits: this.list(dataset, 'commit'), packs: this.list(dataset, 'pack') }; }
  async commits(dataset: string) { return this.list(dataset, 'commit'); }
  async packs(dataset: string) { return this.list(dataset, 'pack'); }
  async checkpoints(dataset: string) { return this.list(dataset, 'checkpoint'); }
  async changes(token: string) { return { token: String(this.events.length), changes: this.events.slice(Number(token)) }; }
  async remove(id: string) { if (this.files.delete(id)) this.events.push({ id, removed: true }); }
}
const password = 'checkpoint test shared passphrase';
const snapshot = (text = 'initial'): Snapshot => ({ version: 18,
  state: { chats: [], contentStore: {}, defaultSystemMessage: text } });

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('publishes checkpoint parts first, verifies a fresh reader, and keeps restart history cold', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  await session.push(snapshot('second'));
  await session.checkpointHistory();
  const checkpoints = await transport.checkpoints(file.id);
  expect(checkpoints.length).toBeGreaterThan(0);
  const manifestIndex = transport.writes.findIndex(write => write.id === checkpoints.at(-1));
  const checkpointId = checkpoints.at(-1)!;
  const key = (session as unknown as { key: CryptoKey }).key;
  const manifest = decode<{ parts: string[] }>(await decrypt(key, transport.files.get(checkpointId)!.bytes, `${file.id}:${checkpointId}`));
  expect(manifest.parts.length).toBeGreaterThan(0);
  for (const part of manifest.parts) {
    const partIndex = transport.writes.findIndex(write => write.id === part && write.kind === 'checkpoint-part');
    expect(partIndex).toBeGreaterThanOrEqual(0);
    expect(partIndex).toBeLessThan(manifestIndex);
  }
  // Checkpoints retain the logical history needed by readers that have no verified local replay.
  expect((await transport.commits(file.id)).length + (await transport.packs(file.id)).length).toBeGreaterThan(0);
  session.close();

  globalThis.indexedDB = new IDBFactory();
  const verified = vi.spyOn(processing, 'decodeVerifyCheckpointAsync');
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('second');
  expect(verified).toHaveBeenCalled();
  for (const call of verified.mock.results) if (call.type === 'return') await expect(call.value).resolves.toBeDefined();
  reader.close();

  const reads = vi.spyOn(storage, 'readSyncEntries');
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  verified.mockClear();
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('second');
  expect(verified).not.toHaveBeenCalled();
  expect(replay).not.toHaveBeenCalled();
  expect(reads.mock.calls.flatMap(([, keys]) => keys).filter(key => key.startsWith('commit:'))).toEqual([]);
  restarted.close();
});

it('rejects an authenticated checkpoint with a self-consistent false state and falls back to history', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  await session.push(snapshot('retained history'));
  await session.checkpointHistory();
  // Simulate another key holder publishing a buggy snapshot: encryption, root and history hashes
  // are all valid, but the snapshot does not equal the replay of those commits.
  const key = (session as unknown as { key: CryptoKey }).key;
  const id = (await transport.checkpoints(file.id)).at(-1)!;
  const stored = transport.files.get(id)!;
  const manifest = decode<{ version: number; parts: string[]; bytes: number; stateRoot: string }>(
    await decrypt(key, stored.bytes, `${file.id}:${id}`));
  const chunks = await Promise.all(manifest.parts.map(async part => decrypt(key,
    transport.files.get(part)!.bytes, `${file.id}:${part}`)));
  const { value: checkpoint } = await decodeNativeParts<Checkpoint>(chunks);
  const setting = Object.keys(checkpoint.records).find(record => record.includes('defaultSystemMessage'))!;
  expect(setting).toBeDefined();
  checkpoint.records[setting] = JSON.stringify('forged state');
  checkpoint.stateRoot = await recordRoot(checkpoint.records, checkpoint.conflicts);
  const payload = await encodeNativeWire(checkpoint);
  const [part] = await transport.ids(1);
  await transport.put(part, file.id, 'checkpoint-part', await encrypt(key, payload, `${file.id}:${part}`));
  stored.bytes = await encrypt(key, encode({ ...manifest, parts: [part], bytes: payload.length,
    stateRoot: checkpoint.stateRoot }), `${file.id}:${id}`);
  session.close();

  globalThis.indexedDB = new IDBFactory();
  const verified = vi.spyOn(processing, 'decodeVerifyCheckpointAsync');
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('retained history');
  expect(verified).toHaveBeenCalled();
  const calls = verified.mock.results.filter(result => result.type === 'return');
  expect(calls.length).toBeGreaterThan(0);
  await expect(calls.at(-1)!.value).rejects.toThrow('differs from replayed history');
  reader.close();
});

it('retries an interrupted checkpoint from immutable ciphertext after restart', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  await session.push(snapshot('durable update'));
  const put = transport.put.bind(transport);
  const attempts = new Map<string, Uint8Array>();
  let interrupted = false;
  transport.put = async (id, dataset, kind, bytes) => {
    if (kind.startsWith('checkpoint')) attempts.set(id, bytes.slice());
    await put(id, dataset, kind, bytes);
    if (kind === 'checkpoint' && !interrupted) { interrupted = true; throw new Error('Checkpoint response lost.'); }
  };
  await expect(session.checkpointHistory()).rejects.toThrow('Checkpoint response lost.');
  expect(interrupted).toBe(true);
  session.close();
  transport.put = async (id, dataset, kind, bytes) => {
    if (attempts.has(id)) expect(bytes).toEqual(attempts.get(id));
    return put(id, dataset, kind, bytes);
  };
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  const allocated = transport.next;
  await restarted.checkpointHistory();
  expect(transport.next).toBe(allocated);
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('durable update');
  for (const [id, bytes] of attempts) expect(transport.files.get(id)!.bytes).toEqual(bytes);
  restarted.close();
});

it('replays authoritative commits when the persisted replay fingerprint does not match', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot('authenticated history'), true);
  const [replay] = await storage.readSyncEntries(file.id, ['replay']);
  expect(replay).toBeDefined();
  const corrupt = replay!.slice(); corrupt[corrupt.length - 1] ^= 1;
  await storage.writeSyncCache(file.id, undefined, [['replay', corrupt]]);
  session.close();
  const reads = vi.spyOn(storage, 'readSyncEntries');
  const replayed = vi.spyOn(processing, 'replayHistoryAsync');
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('authenticated history');
  expect(replayed).toHaveBeenCalled();
  expect(reads.mock.calls.flatMap(([, keys]) => keys).some(key => key.startsWith('commit:'))).toBe(true);
  restarted.close();
});

it('recovers a missing cold history entry from retained cloud history before compaction', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot('recoverable history'), true);
  const [commit] = await transport.commits(file.id);
  await storage.writeSyncCache(file.id, undefined, [], [`commit:${commit}`]);
  session.close();
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('recoverable history');
  await restarted.compactHistory();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('recoverable history');
  expect((await transport.packs(file.id)).length).toBeGreaterThan(0);
  restarted.close();
});

it('does not accept a cloud checkpoint as a replacement for an older local baseline', async () => {
  const transport = new CheckpointTransport();
  const writerDatabase = indexedDB;
  const { session, file } = await EncryptedSync.create(transport, password);
  const original = snapshot('accepted local version');
  await session.push(original, true);
  const readerDatabase = new IDBFactory(); globalThis.indexedDB = readerDatabase;
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  await reader.acceptLocal(await reader.pull());

  globalThis.indexedDB = writerDatabase;
  await session.push(snapshot('new cloud version'));
  await session.checkpointHistory();
  session.close();
  globalThis.indexedDB = readerDatabase;
  expect((await reader.pull()).state.defaultSystemMessage).toBe('new cloud version');
  const commits = await transport.commits(file.id);
  // Local data is still the accepted old version, so it is unchanged relative to that baseline.
  // Accepting the checkpoint as the baseline would incorrectly publish this old value as a new edit.
  expect((await reader.synchronize(original)).state.defaultSystemMessage).toBe('new cloud version');
  expect(await transport.commits(file.id)).toEqual(commits);
  reader.close();
});

it('automatically checkpoints the first history and then 128 additional commits', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  expect(await transport.checkpoints(file.id)).toHaveLength(1);
  for (let i = 1; i < 128; i++) await session.push(snapshot(`synthetic update ${i}`));
  expect(await transport.checkpoints(file.id)).toHaveLength(1);
  await session.push(snapshot('synthetic update 128'));
  expect(await transport.checkpoints(file.id)).toHaveLength(2);
  session.close();
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('synthetic update 128');
  reader.close();
}, 30_000);


it('replays an older cold branch after adopting a larger checkpoint for another branch', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  const [root] = await transport.commits(file.id);
  const source = (session as unknown as { cache: { commits: Record<string, Commit> } }).cache.commits[root];
  let simulatedTime = performance.now();
  const now = vi.spyOn(performance, 'now').mockImplementation(() => simulatedTime += 6 * 60_000);
  await session.push(snapshot('older branch'));
  now.mockRestore();
  const key = (session as unknown as { key: CryptoKey }).key;
  const [storedReplay] = await storage.readSyncEntries(file.id, ['replay']);
  const replayState = await decodeCache<{ commits: string[] }>(await decrypt(key, storedReplay!, `${file.id}:replay`));
  expect(replayState.commits.sort()).toEqual((await transport.commits(file.id)).sort());
  session.close();
  const setting = JSON.stringify(['state', 'defaultSystemMessage']);
  const b: Commit = { version: 1, parents: [root], changes: [{ key: setting,
    before: await digest(JSON.stringify('initial')), after: JSON.stringify('branch b') }] };
  const c: Commit = { version: 1, parents: ['branch-b'], changes: [{ key: setting,
    before: await digest(JSON.stringify('branch b')), after: JSON.stringify('branch c') }] };
  for (const [id, commit] of [['branch-b', b], ['branch-c', c]] as const) {
    await transport.put(id, file.id, 'commit', await encrypt(key, encode({ ...commit, version: 2 }), `${file.id}:${id}`));
  }
  const checkpoint = await createCheckpoint({ [root]: source, 'branch-b': b, 'branch-c': c }, ['branch-c']);
  const payload = await encodeNativeWire(checkpoint);
  const [id, part] = await transport.ids(2);
  await transport.put(part, file.id, 'checkpoint-part', await encrypt(key, payload, `${file.id}:${part}`));
  await transport.put(id, file.id, 'checkpoint', await encrypt(key, encode({ version: 1, parts: [part],
    bytes: payload.length, stateRoot: checkpoint.stateRoot }), `${file.id}:${id}`));
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  await expect(restarted.pull()).rejects.toThrow('Concurrent edits conflict');
  expect(replay).toHaveBeenCalled();
  restarted.close();
});

it('does not block a successful commit when the optional aggregate checkpoint exceeds its encoding limit', async () => {
  const transport = new CheckpointTransport();
  const { session } = await EncryptedSync.create(transport, password);
  const encoding = vi.spyOn(processing, 'createEncodedCheckpointAsync')
    .mockRejectedValue(new Error('Native sync payload exceeds the byte limit.'));
  await session.push(snapshot('within commit limit'), true);
  expect(encoding).toHaveBeenCalled();
  expect((await session.pull()).state.defaultSystemMessage).toBe('within commit limit');
  session.close();
});

it('resends acknowledged checkpoint parts with the same ciphertext if readback finds them missing', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  await session.push(snapshot('checkpoint repair'));
  const put = transport.put.bind(transport);
  const original = new Map<string, { dataset: string; kind: string; bytes: Uint8Array }>();
  const parts: string[] = [];
  transport.put = async (id, dataset, kind, bytes) => {
    await put(id, dataset, kind, bytes);
    if (kind === 'checkpoint-part') { parts.push(id); original.set(id, { dataset, kind, bytes: bytes.slice() }); }
    if (kind === 'checkpoint') {
      for (const part of parts) transport.files.delete(part);
    }
  };
  await expect(session.checkpointHistory()).rejects.toThrow('Missing file.');
  expect(parts.length).toBeGreaterThan(0);
  session.close();
  const retried: string[] = [];
  transport.put = async (id, dataset, kind, bytes) => {
    if (original.has(id)) { expect(bytes).toEqual(original.get(id)!.bytes); retried.push(id); }
    return put(id, dataset, kind, bytes);
  };
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  const allocated = transport.next;
  await restarted.checkpointHistory();
  expect(transport.next).toBe(allocated);
  expect(new Set(retried)).toEqual(new Set(parts));
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('checkpoint repair');
  restarted.close();
});


it('retains cold history, baseline and checkpoint outbox when a best-effort recovery fails once', async () => {
  const transport = new CheckpointTransport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(snapshot(), true);
  const latest = snapshot('latest accepted edit');
  let simulatedTime = performance.now();
  const now = vi.spyOn(performance, 'now').mockImplementation(() => simulatedTime += 6 * 60_000);
  await session.push(latest);
  now.mockRestore();
  const commits = await transport.commits(file.id);
  const latestCommit = commits.at(-1)!;
  const key = (session as unknown as { key: CryptoKey }).key;
  const metadata = async () => decodeCache<{
    commits: string[]; baseline: Record<string, string>;
    checkpointUpload?: { id: string; files: { id: string }[] };
  }>(await decrypt(key, (await storage.syncCache(file.id))!, `${file.id}:cache`));
  const put = transport.put.bind(transport);
  transport.put = async (id, dataset, kind, bytes) => {
    await put(id, dataset, kind, bytes);
    if (kind === 'checkpoint') throw new Error('Checkpoint response lost.');
  };
  await expect(session.checkpointHistory()).rejects.toThrow('Checkpoint response lost.');
  const before = await metadata();
  const [savedReplay] = await storage.readSyncEntries(file.id, ['replay']);
  const replayState = await decodeCache<{ commits: string[] }>(await decrypt(key, savedReplay!, `${file.id}:replay`));
  expect(replayState.commits).toContain(latestCommit);
  expect(before.checkpointUpload).toBeDefined();
  await storage.writeSyncCache(file.id, undefined, [], [`commit:${latestCommit}`]);
  session.close();
  transport.put = put;
  const read = transport.read.bind(transport);
  let failures = 0;
  transport.read = async id => {
    if (id === latestCommit && failures === 0) { failures++; throw new Error('Temporary remote read failure.'); }
    return read(id);
  };
  const reader = new EncryptedSync(file.id, transport);
  await reader.restoreKey();
  // finishCompaction catches the optional checkpoint failure. That catch must not discard the
  // known cold ID before refresh saves metadata or cause remote() to return the older parent state.
  expect((await reader.pull()).state.defaultSystemMessage).toBe('latest accepted edit');
  expect(failures).toBe(1);
  const afterFailure = await metadata();
  expect([...afterFailure.commits].sort()).toEqual([...before.commits].sort());
  expect(afterFailure.baseline).toEqual(before.baseline);
  expect(afterFailure.checkpointUpload).toEqual(before.checkpointUpload);
  const outbox = afterFailure.checkpointUpload!.files.map(entry => `outbox:${entry.id}`);
  expect((await storage.readSyncEntries(file.id, outbox)).every(Boolean)).toBe(true);
  // Once cloud reads recover, ordinary synchronization can finish the same checkpoint without
  // turning the unchanged accepted local value into another edit.
  expect((await reader.synchronize(latest)).state.defaultSystemMessage).toBe('latest accepted edit');
  expect(await transport.commits(file.id)).toEqual(commits);
  expect((await metadata()).checkpointUpload).toBeUndefined();
  reader.close();
  const restarted = new EncryptedSync(file.id, transport);
  await restarted.restoreKey();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('latest accepted edit');
  const afterRestart = await metadata();
  expect([...afterRestart.commits].sort()).toEqual([...before.commits].sort());
  expect(afterRestart.baseline).toEqual(before.baseline);
  restarted.close();
});
