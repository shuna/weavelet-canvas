import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as processing from '../google/processing';
import * as legacyCodec from '../google/crypto';
import { decodeNativeParts, encodeNativeWire, hashNativeCommits } from '../google/nativeWireCodec';
import * as cacheStorage from '../google/cache';
import { decode, decrypt, digest, encode, encrypt } from '../google/crypto';
import { replayHistory } from '../google/replay';
import { decodeCache, encodeCache } from '../google/cacheCodec';
import { IDBFactory } from 'fake-indexeddb';
import { EncryptedSync } from './EncryptedSync';
import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from './transport';
import { toRecords, type Snapshot } from '../google/records';
import { addContent } from '@utils/contentStore';
import { useGoogleSyncProgress, withSyncProgress } from '../google/progress';

class MemoryTransport implements SyncTransport {
  next = 0;
  headers = new Map<string, string>();
  files = new Map<string, { dataset: string; kind: string; bytes: Uint8Array }>();
  events: SyncChange[] = [];
  writes: string[] = [];
  historyCalls = 0;
  failHistory = false;
  hidden = new Set<string>();
  async ids(count: number) { return Array.from({ length: count }, () => `memory-${++this.next}`); }
  async folder(id: string, headerId: string) { this.headers.set(id, headerId); return { id }; }
  async keyHeader(dataset: string) {
    const header = this.headers.get(dataset);
    if (!header) throw new SyncFileNotFoundError('Missing dataset.');
    return header;
  }
  async read(id: string) {
    const file = this.files.get(id);
    if (!file || this.hidden.has(id)) throw new SyncFileNotFoundError('File has not arrived.');
    return file.bytes.slice();
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
    const existing = this.files.get(id);
    if (existing) { expect(existing.bytes).toEqual(bytes); return; }
    this.files.set(id, { dataset, kind, bytes: bytes.slice() });
    this.events.push({ id, dataset, kind });
    this.writes.push(kind);
  }
  async startToken() { return String(this.events.length); }
  async history(dataset: string) {
    this.historyCalls++; if (this.failHistory) throw new Error('listing failed');
    return { commits: this.list(dataset, 'commit'), packs: this.list(dataset, 'pack') };
  }
  async commits(dataset: string) { return this.list(dataset, 'commit'); }
  async packs(dataset: string) { return this.list(dataset, 'pack'); }
  private list(dataset: string, kind: string) {
    return [...this.files].filter(([, file]) => file.dataset === dataset && file.kind === kind).map(([id]) => id);
  }
  async changes(token: string) { return { token: String(this.events.length), changes: this.events.slice(Number(token)) }; }
  async remove(id: string) { if (this.files.delete(id)) this.events.push({ id, removed: true }); }
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('scans history once for a fresh reader and uses changes after the cursor is saved', async () => {
  const transport = new MemoryTransport();
  const password = 'test-only shared sync passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push({ version: 18, state: { chats: [], contentStore: {}, defaultSystemMessage: 'dark' } }, true);
  globalThis.indexedDB = new IDBFactory();
  transport.historyCalls = 0;
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  await reader.pull();
  expect(transport.historyCalls).toBe(1);
  await reader.pull();
  expect(transport.historyCalls).toBe(1);
});

it('does not retain a provisional cursor when initial history listing fails', async () => {
  const transport = new MemoryTransport(), password = 'test-only shared sync passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push({ version: 18, state: { chats: [], contentStore: {}, defaultSystemMessage: 'dark' } }, true);
  globalThis.indexedDB = new IDBFactory(); transport.historyCalls = 0; transport.failHistory = true;
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  await expect(reader.pull()).rejects.toThrow('listing failed');
  transport.failHistory = false;
  await reader.pull();
  expect(transport.historyCalls).toBe(2);
});

it('accepts a commit published after the initial history listing through changes', async () => {
  const transport = new MemoryTransport(), password = 'test-only shared sync passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  const before: Snapshot = { version: 18, state: { chats: [], contentStore: {}, defaultSystemMessage: 'dark' } };
  await session.push(before, true);
  const oldEvents = transport.events.length;
  const after = structuredClone(before); after.state.defaultSystemMessage = 'light';
  await session.push(after);
  const deferred = transport.events.splice(oldEvents);
  transport.history = async dataset => {
    const hidden = new Set(deferred.map(event => event.id));
    const commits = [...transport.files].filter(([id, file]) => file.dataset === dataset && file.kind === 'commit' && !hidden.has(id)).map(([id]) => id);
    transport.events.push(...deferred);
    return { commits, packs: [] };
  };
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('light');
});

it('shares encrypted delta sync with a non-Drive transport and retries dependencies arriving later', async () => {
  const transport = new MemoryTransport();
  const password = 'test-only shared sync passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  const original: Snapshot = { version: 18, state: { chats: [{
    id: 'chat', title: 'initial', messages: [{ role: 'user', content: [{ type: 'text', text: 'private body' }] }],
    titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  }], contentStore: {}, defaultSystemMessage: 'dark' } };
  await session.push(original, true);
  const changed = structuredClone(original);
  changed.state.chats![0].title = 'changed';
  const before = transport.writes.length;
  await session.push(changed);
  expect(transport.writes.slice(before)).toEqual(['commit']);
  for (const stored of transport.files.values()) {
    expect(new TextDecoder().decode(stored.bytes)).not.toContain('private body');
  }

  // A new browser has only the shared files, with the commit arriving before its payload.
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  transport.hidden = new Set([...transport.files].filter(([, value]) => value.kind === 'part').map(([id]) => id));
  await expect(reader.pull()).rejects.toThrow('not arrived');
  transport.hidden.clear();
  expect((await reader.pull()).state.chats![0].title).toBe('changed');
  await reader.acceptLocal(await reader.pull());
  const downloaded = await reader.pull();
  downloaded.state.defaultSystemMessage = 'light';
  await reader.push(downloaded);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('light');
});

it('downloads without publishing a persisted outbox and discards it only after acceptance', async () => {
  const transport = new MemoryTransport();
  const { session, file } = await EncryptedSync.create(transport, 'test-only shared passphrase');
  const original: Snapshot = { version: 18, state: { defaultSystemMessage: 'dark', chats: [], contentStore: {} } };
  await session.push(original, 'if-empty');
  const write = transport.put.bind(transport);
  transport.put = async (...args) => { if (args[2] === 'commit') throw new Error('offline'); return write(...args); };
  await expect(session.push({ ...original, state: { ...original.state, defaultSystemMessage: 'light' } })).rejects.toThrow('offline');
  const reader = new EncryptedSync(file.id, transport);
  await reader.restoreKey();
  transport.put = write;
  const count = transport.writes.length;
  const overview = await reader.overview();
  expect(overview).toMatchObject({ chats: 0, messages: 0, versions: 1 });
  expect(overview.bytes).toBeGreaterThan(0);
  expect(transport.writes).toHaveLength(count);
  const review = await reader.inspect();
  expect(review.snapshot.state.defaultSystemMessage).toBe('dark');
  expect(review.versions).toEqual([]);
  expect(transport.writes).toHaveLength(count);
  const received = await reader.pull(false);
  expect(received.state.defaultSystemMessage).toBe('dark');
  expect(transport.writes).toHaveLength(count);
  await reader.acceptLocal(received, true);
  await reader.push(received);
  expect(transport.writes).toHaveLength(count);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('dark');
});

it('does not initialize over existing history when another browser has no baseline', async () => {
  const transport = new MemoryTransport();
  const { session, file } = await EncryptedSync.create(transport, 'test-only shared passphrase');
  const original: Snapshot = { version: 18, state: { defaultSystemMessage: 'dark', chats: [], contentStore: {} } };
  await session.push(original, 'if-empty');
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock('test-only shared passphrase');
  const count = transport.writes.length;
  await expect(reader.push({ ...original, state: { ...original.state, defaultSystemMessage: 'light' } }, 'if-empty')).rejects.toThrow('downloaded');
  expect(transport.writes).toHaveLength(count);
});

it('retains an authenticated replay for an unchanged cursor and drops it after a failed refresh', async () => {
  const transport = new MemoryTransport();
  const { session, file } = await EncryptedSync.create(transport, 'test-only shared passphrase');
  const original: Snapshot = { version: 18, state: { defaultSystemMessage: 'dark', chats: [], contentStore: {} } };
  await session.push(original, true);
  await session.pull();
  const replay = (session as any).remoteCache;
  await (session as any).remote();
  expect((session as any).remoteCache.records).toBe(replay.records);
  transport.changes = async token => ({ token, changes: [{ id: 'missing-commit', dataset: file.id, kind: 'commit' }] });
  await expect(session.pull()).rejects.toThrow('not arrived');
  expect((session as any).remoteCache).toBeUndefined();
});

const smallSnapshot = (): Snapshot => ({ version: 18, state: {
  chats: [], contentStore: {}, defaultSystemMessage: 'initial',
} });

it('upgrades legacy LZ metadata/replay while keeping remote commits unchanged', async () => {
  const transport = new MemoryTransport(), password = 'test-only cache codec passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy' });
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const remote = new Map([...transport.files].map(([id, value]) => [id, value.bytes.slice()]));
  const metadata = await decodeCache<any>(await decrypt(internal.key, (await cacheStorage.syncCache(file.id))!, internal.context('cache')));
  delete metadata.replayFingerprint; delete metadata.historyParents;
  await cacheStorage.writeSyncCache(file.id, await encrypt(internal.key, encode(metadata), internal.context('cache')),
    [['replay', await encrypt(internal.key, encode(internal.persistedReplay), internal.context('replay'))]]);
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  // Old replay data has no atomically bound parent index; verify history once before trusting it.
  expect(replay).toHaveBeenCalledTimes(1);
  const restarted = new EncryptedSync(file.id, transport); await restarted.unlock(password);
  replay.mockClear();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('initial');
  expect(replay).not.toHaveBeenCalled();
  const rewritten = await decrypt(internal.key, (await cacheStorage.syncCache(file.id))!, internal.context('cache'));
  expect([...rewritten.slice(0, 8)]).toEqual([87, 76, 67, 65, 67, 72, 69, 1]);
  for (const [id, bytes] of remote) expect(transport.files.get(id)!.bytes).toEqual(bytes);
});

it('falls back from invalid authenticated gzip replay but rejects unknown metadata versions', async () => {
  const transport = new MemoryTransport(), password = 'test-only cache codec passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const malformed = (await encodeCache(internal.persistedReplay)).slice(0, 12);
  await cacheStorage.writeSyncCache(file.id, undefined,
    [['replay', await encrypt(internal.key, malformed, internal.context('replay'))]]);
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  expect(replay).toHaveBeenCalledTimes(1);
  const metadata = await decrypt(internal.key, (await cacheStorage.syncCache(file.id))!, internal.context('cache'));
  metadata[7] = 255;
  await cacheStorage.writeSyncCache(file.id, await encrypt(internal.key, metadata, internal.context('cache')));
  const invalid = new EncryptedSync(file.id, transport);
  await invalid.unlock(password);
  await expect(invalid.pull()).rejects.toThrow('Unsupported sync cache format.');
});

it('restores an encrypted replay after restart and falls back for missing or damaged acceleration data', async () => {
  const transport = new MemoryTransport(), password = 'test-only replay passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(smallSnapshot(), true);
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  expect(replay).not.toHaveBeenCalled();
  for (const damaged of [false, true]) {
    if (damaged) await cacheStorage.writeSyncCache(file.id, undefined, [['replay', new Uint8Array([1, 2, 3])]]);
    else await cacheStorage.writeSyncCache(file.id, undefined, [], ['replay']);
    const recovering = new EncryptedSync(file.id, transport); await recovering.unlock(password);
    replay.mockClear();
    expect((await recovering.pull()).state.defaultSystemMessage).toBe('initial');
    expect(replay).toHaveBeenCalledTimes(1);
  }
});

it('incrementally applies only a direct single-head continuation and replays old-ancestor branches', async () => {
  const transport = new MemoryTransport();
  const { session } = await EncryptedSync.create(transport, 'test-only replay passphrase');
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const parent = internal.remoteCache.tips[0];
  const key = JSON.stringify(['state', 'defaultSystemMessage']);
  const first = { version: 1 as const, parents: [parent], changes: [{ key, before: await digest('"initial"'), after: '"next"' }] };
  internal.cache.commits.next = first;
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  expect((await internal.remote())[key]).toBe('"next"');
  expect(replay).not.toHaveBeenCalled();
  internal.cache.commits.branch = { ...first, changes: [{ ...first.changes[0], after: '"branch"' }] };
  const expected = await replayHistory({ commits: internal.cache.commits, tips: internal.heads() });
  await internal.remote(true);
  expect(replay).toHaveBeenCalledTimes(1);
  expect(internal.remoteCache.records).toEqual(expected.records);
  expect(internal.remoteCache.conflicts).toEqual(expected.conflicts);
});

it('retains replay semantics for deletion and presentation changes', async () => {
  const transport = new MemoryTransport();
  const { session } = await EncryptedSync.create(transport, 'test-only replay passphrase');
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const key = JSON.stringify(['state', 'defaultSystemMessage']);
  internal.cache.commits.deleted = { version: 1, parents: internal.heads(), changes: [{ key, before: await digest('"initial"'), after: null }] };
  await internal.remote();
  expect(replay).toHaveBeenCalledTimes(1);
  const expanded = JSON.stringify(['state', 'folders', 'folder', 'expanded']);
  internal.cache.commits.presentation = { version: 1, parents: internal.heads(), changes: [{ key: expanded, before: null, after: 'true' }] };
  await internal.remote();
  expect(replay).toHaveBeenCalledTimes(2);
  expect(internal.remoteCache.records).toEqual((await replayHistory({ commits: internal.cache.commits, tips: internal.heads() })).records);
});

it('discards an uncommitted replay after storage failure and rejects a stale tab', async () => {
  const transport = new MemoryTransport(), password = 'test-only replay passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const key = JSON.stringify(['state', 'defaultSystemMessage']);
  internal.cache.commits.unsaved = { version: 1, parents: internal.heads(), changes: [{ key, before: await digest('"initial"'), after: '"unsaved"' }] };
  vi.spyOn(cacheStorage, 'writeSyncCache').mockRejectedValueOnce(new Error('disk full'));
  await expect(internal.run(() => internal.remote())).rejects.toThrow('disk full');
  expect(internal.remoteCache).toBeUndefined();
  expect((await session.pull()).state.defaultSystemMessage).toBe('initial');
  const another = new EncryptedSync(file.id, transport); await another.unlock(password);
  await another.pull();
  const after = smallSnapshot(); after.state.defaultSystemMessage = 'published';
  await another.push(after);
  await expect(session.pull()).rejects.toThrow('Another tab');
});

it('does not resend identical immutable bodies absent from the local baseline', async () => {
  const transport = new MemoryTransport();
  const { session } = await EncryptedSync.create(transport, 'test-only immutable passphrase');
  const snapshot = smallSnapshot();
  snapshot.state.contentStore = { body: { content: [{ type: 'text', text: 'synthetic body' }], refCount: 1 } };
  snapshot.state.chats = [{ id: 'chat', title: 'synthetic', messages: [], titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
    branchTree: { rootId: 'node', activePath: ['node'], nodes: {
      node: { id: 'node', parentId: null, role: 'user', contentHash: 'body', createdAt: 1 },
    } },
  }];
  await session.push(snapshot, true);
  const internal = session as any;
  for (const key of Object.keys(internal.cache.baseline)) if (JSON.parse(key)[0] === 'content') delete internal.cache.baseline[key];
  const writes = transport.writes.length;
  await session.push(snapshot);
  expect(transport.writes.length).toBe(writes);
  const changed = structuredClone(snapshot); changed.state.chats![0].branchTree!.nodes.node.label = 'changed';
  await session.push(changed);
  const commit = internal.cache.commits[internal.heads()[0]];
  expect(commit.changes.some((change: any) => JSON.parse(change.key)[0] === 'content')).toBe(false);
  expect(commit.changes.some((change: any) => change.key.endsWith(',"label"]'))).toBe(true);
  const contentKey = Object.keys(internal.remoteCache.records).find(key => JSON.parse(key)[0] === 'content')!;
  internal.remoteCache.records[contentKey] = '[{"type":"text","text":"damaged remote body"}]';
  delete internal.cache.baseline[contentKey];
  const beforeCorruption = transport.writes.length;
  await expect(session.push(changed)).rejects.toThrow();
  expect(transport.writes.length).toBe(beforeCorruption);
});

it('replays node restoration so a previously repaired activePath is restored too', async () => {
  const transport = new MemoryTransport();
  const { session } = await EncryptedSync.create(transport, 'test-only path passphrase');
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const prefix = ['chats', 'chat', 'branchTree'];
  const path = JSON.stringify([...prefix, 'activePath']);
  const nodeId = JSON.stringify([...prefix, 'nodes', 'child', 'id']);
  const values: Record<string, string> = {
    [JSON.stringify(['chats', 'chat', 'id'])]: '"chat"',
    [JSON.stringify([...prefix, 'rootId'])]: '"root"',
    [path]: '["root","child"]',
    [JSON.stringify([...prefix, 'nodes', 'root', 'id'])]: '"root"',
    [JSON.stringify([...prefix, 'nodes', 'root', 'parentId'])]: 'null',
    [nodeId]: '"child"',
    [JSON.stringify([...prefix, 'nodes', 'child', 'parentId'])]: '"root"',
  };
  internal.cache.commits.tree = { version: 1, parents: internal.heads(), changes: Object.entries(values).map(([key, after]) => ({ key, before: null, after })) };
  await internal.remote();
  internal.cache.commits.deleted = { version: 1, parents: internal.heads(), changes: [{ key: nodeId, before: await digest('"child"'), after: null }] };
  expect((await internal.remote())[path]).toBe('["root"]');
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  internal.cache.commits.restored = { version: 1, parents: internal.heads(), changes: [{ key: nodeId, before: null, after: '"child"' }] };
  expect((await internal.remote())[path]).toBe('["root","child"]');
  expect(replay).toHaveBeenCalledTimes(1);
});

it('reuses replay across verified pack replacement without treating file changes as new history', async () => {
  const transport = new MemoryTransport(), password = 'test-only pack passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(smallSnapshot(), true);
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  await session.compactHistory();
  expect([...transport.files.values()].some(file => file.kind === 'pack')).toBe(true);
  expect(replay).not.toHaveBeenCalled();
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  expect(replay).not.toHaveBeenCalled();
});


it('normalizes timestamp representations in incremental replay exactly as full replay does', async () => {
  const { session } = await EncryptedSync.create(new MemoryTransport(), 'test-only timestamp passphrase');
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const key = JSON.stringify(['state', 'lastContentEditedAt']);
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  internal.cache.commits.time1 = { version: 1, parents: internal.heads(), changes: [{ key, before: null, after: '1e3' }] };
  expect((await internal.remote())[key]).toBe('1000');
  internal.cache.commits.time2 = { version: 1, parents: internal.heads(), changes: [{ key, before: await digest('1000'), after: '2000.0' }] };
  expect((await internal.remote())[key]).toBe('2000');
  expect(replay).not.toHaveBeenCalled();
  expect(internal.remoteCache.records).toEqual((await replayHistory({ commits: internal.cache.commits, tips: internal.heads() })).records);
});

it.each(['records', 'conflicts'])('ignores an authenticated malformed replay with an array in %s', async field => {
  const transport = new MemoryTransport(), password = 'test-only malformed replay passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const malformed = { ...internal.persistedReplay, [field]: [] };
  const bytes = await encrypt(internal.key, encode(malformed), internal.context('replay'));
  await cacheStorage.writeSyncCache(file.id, undefined, [['replay', bytes]]);
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  expect(replay).toHaveBeenCalledTimes(1);
});

it('restores multiple title edits from an old checkpoint without recompressing it after every edit', async () => {
  const transport = new MemoryTransport(), password = 'test-only checkpoint passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  const original = smallSnapshot();
  original.state.chats = [{ id: 'chat', title: 'initial', messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic checkpoint fixture' }] }],
    titleSet: true, imageDetail: 'auto', config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 } }];
  await session.push(original, true);
  const internal = session as any, checkpoint = internal.persistedReplay;
  const [before] = await cacheStorage.readSyncEntries(file.id, ['replay']);
  const encoding = vi.spyOn(processing, 'encodeAsync');
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  for (const title of ['first', 'second', 'third']) {
    const edited = structuredClone(original); edited.state.chats![0].title = title;
    await session.push(edited);
  }
  expect(internal.persistedReplay).toBe(checkpoint);
  expect(internal.remoteCache.commits.length).toBe(checkpoint.commits.length + 3);
  expect(encoding.mock.calls.filter(([value]: any[]) => value && Array.isArray(value.commits) && value.records)).toHaveLength(0);
  const [after] = await cacheStorage.readSyncEntries(file.id, ['replay']);
  expect(after).toEqual(before);
  expect(replay).not.toHaveBeenCalled();
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.chats![0].title).toBe('third');
  expect(replay).not.toHaveBeenCalled();
  expect((reader as any).remoteCache.records).toEqual(internal.remoteCache.records);
});

it('falls back after restart when updates after the checkpoint include simultaneous branches', async () => {
  const transport = new MemoryTransport(), password = 'test-only branch checkpoint passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(smallSnapshot(), true);
  const internal = session as any, parent = internal.persistedReplay.tips[0];
  const key = JSON.stringify(['state', 'defaultSystemMessage']);
  for (const [id, value] of [['left', 'left fixture'], ['right', 'right fixture']]) {
    internal.cache.commits[id] = { version: 1, parents: [parent], changes: [{ key, before: await digest('"initial"'), after: JSON.stringify(value) }] };
  }
  await internal.save();
  const expected = await replayHistory({ commits: internal.cache.commits, tips: internal.heads() });
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  await (reader as any).run(() => (reader as any).remote(true));
  expect(replay).toHaveBeenCalledTimes(1);
  expect((reader as any).remoteCache.records).toEqual(expected.records);
  expect((reader as any).remoteCache.conflicts).toEqual(expected.conflicts);
});

it('ignores an optional pack checkpoint with matching commit IDs but different state and replays authenticated history', async () => {
  const transport = new MemoryTransport(), password = 'test-only untrusted checkpoint passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy' });
  const snapshot = smallSnapshot();
  await session.push(snapshot, true);
  await session.compactHistory();
  const internal = session as any;
  const [id, pack] = [...transport.files].find(([, value]) => value.kind === 'pack')!;
  const manifest = decode<any>(await decrypt(internal.key, pack.bytes, internal.context(id)));
  const [part] = manifest.parts;
  const payload = decode<any>(await decrypt(internal.key, transport.files.get(part)!.bytes, internal.context(part)));
  const key = JSON.stringify(['state', 'defaultSystemMessage']);
  payload.checkpoint = { version: 1, commits: Object.keys(internal.cache.commits).sort(), tips: internal.heads(), conflicts: {},
    records: { ...internal.remoteCache.records, [key]: JSON.stringify('different state only in checkpoint') } };
  const bytes = encode(payload);
  transport.files.get(part)!.bytes = await encrypt(internal.key, bytes, internal.context(part));
  manifest.bytes = bytes.length;
  pack.bytes = await encrypt(internal.key, encode(manifest), internal.context(id));
  globalThis.indexedDB = new IDBFactory();
  const replay = vi.spyOn(processing, 'replayHistoryAsync');
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  expect(replay).toHaveBeenCalledTimes(1);
  expect((reader as any).remoteCache.records).toEqual(await toRecords(snapshot));
});

it.each([false, true])('round-trips wireDelta=%s commits and packs through fresh readers, while default clients can still publish legacy changes', async wireDelta => {
  const transport = new MemoryTransport(), password = 'test-only wire integration passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy', wireDelta, partBytes: 4096 });
  const writerDb = globalThis.indexedDB, internal = session as any;
  let random = 7;
  const base = Array.from({ length: 18000 }, () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(33 + random % 90);
  }).join('');
  const snapshot = smallSnapshot(), store = snapshot.state.contentStore!;
  const bodies = [base, base.slice(0, 7000) + ' edited ' + base.slice(7008), base.slice(0, 12000) + ' another edit ' + base.slice(12014)];
  const hashes = bodies.map(text => addContent(store, [{ type: 'text', text }]));
  snapshot.state.chats = [{ id: 'chat', title: 'wire fixture', messages: [], titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    branchTree: { rootId: 'n0', activePath: ['n0'], nodes: Object.fromEntries(hashes.map((contentHash, i) => [`n${i}`,
      { id: `n${i}`, parentId: i ? 'n0' : null, role: 'assistant' as const, contentHash, createdAt: 1 }])) },
  }];
  await session.push(snapshot, true);
  const [commitId, commitFile] = [...transport.files].find(([, value]) => value.kind === 'commit')!;
  const commitManifest = decode<any>(await decrypt(internal.key, commitFile.bytes, internal.context(commitId)));
  expect(commitManifest.version).toBe(wireDelta ? 3 : 1);
  expect(commitManifest.parts.length).toBeGreaterThan(1);
  const expected = await toRecords(snapshot);

  globalThis.indexedDB = new IDBFactory();
  const readerDb = globalThis.indexedDB;
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  const downloadTotals: number[] = [];
  const unsubscribe = useGoogleSyncProgress.subscribe(state => {
    if (state.phase === 'downloading' && state.totalFiles !== undefined) downloadTotals.push(state.totalFiles);
  });
  let received: Snapshot;
  try { received = await withSyncProgress(() => reader.pull()); }
  finally { unsubscribe(); }
  expect(downloadTotals).toContain(commitManifest.parts.length + 1);
  expect(await toRecords(received)).toEqual(expected);
  await reader.acceptLocal(received);
  received.state.chats![0].title = 'default-client title';
  await reader.push(received);
  const [legacyId, legacyFile] = [...transport.files].filter(([, value]) => value.kind === 'commit').at(-1)!;
  const legacyManifest = decode<any>(await decrypt(internal.key, legacyFile.bytes, internal.context(legacyId)));
  expect(legacyManifest.version).toBe(2);

  globalThis.indexedDB = writerDb;
  const restarted = new EncryptedSync(file.id, transport); await restarted.unlock(password);
  const latest = await restarted.pull();
  expect(latest.state.chats![0].title).toBe('default-client title');
  expect((restarted as any).options.wireDelta).toBe(wireDelta);
  await restarted.compactHistory();
  const [packId, packFile] = [...transport.files].find(([, value]) => value.kind === 'pack')!;
  const manifest = decode<any>(await decrypt(internal.key, packFile.bytes, internal.context(packId)));
  expect(manifest.version).toBe(wireDelta ? 2 : 1);
  expect([...transport.files.values()].filter(value => value.kind === 'commit')).toHaveLength(0);

  // A third browser must authenticate and decode pack payloads without either local replay cache.
  globalThis.indexedDB = new IDBFactory();
  const fresh = new EncryptedSync(file.id, transport); await fresh.unlock(password);
  expect(await toRecords(await fresh.pull())).toEqual(await toRecords(latest));
  expect(Object.keys((fresh as any).cache.commits)).toHaveLength(2);
  // Existing readers also follow source deletion through the replacement pack.
  globalThis.indexedDB = readerDb;
  expect(await toRecords(await reader.pull())).toEqual(await toRecords(latest));
}, 15000);

it('uses native opt-in commits and canonical-hash packs without large legacy LZ calls', async () => {
  const transport = new MemoryTransport(), password = 'test-only native integration passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, {
    wireCompression: 'gzip', wireDelta: true, partBytes: 2048,
  });
  const internal = session as any;
  const snapshot = smallSnapshot(), store = snapshot.state.contentStore!;
  const hash = addContent(store, [{ type: 'text', text: 'Synthetic native protocol body. '.repeat(40000) }]);
  snapshot.state.chats = [{ id: 'chat', title: 'native fixture', messages: [], titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    branchTree: { rootId: 'node', activePath: ['node'], nodes: {
      node: { id: 'node', parentId: null, role: 'assistant', contentHash: hash, createdAt: 1 },
    } },
  }];
  const legacy = vi.spyOn(legacyCodec, 'encode');
  await session.push(snapshot, true);
  const [id, initial] = [...transport.files].find(([, value]) => value.kind === 'commit')!;
  const manifest = decode<any>(await decrypt(internal.key, initial.bytes, internal.context(id)));
  expect(manifest.version).toBe(4);
  expect(manifest.parts.length).toBeGreaterThan(1);
  const [local] = await cacheStorage.readSyncEntries(file.id, [`commit:${id}`]);
  const cachedBytes = await decrypt(internal.key, local!, internal.context(`commit:${id}`));
  expect([...cachedBytes.slice(0, 8)]).toEqual([87, 76, 67, 65, 67, 72, 69, 1]);
  await session.compactHistory();
  const [packId, packed] = [...transport.files].find(([, value]) => value.kind === 'pack')!;
  const index = decode<any>(await decrypt(internal.key, packed.bytes, internal.context(packId)));
  expect(index.version).toBe(3);
  expect(index.commits).toEqual(await hashNativeCommits(internal.cache.commits));
  expect([...transport.files.values()].some(value => value.kind === 'commit')).toBe(false);
  globalThis.indexedDB = new IDBFactory();
  const fresh = new EncryptedSync(file.id, transport); await fresh.unlock(password);
  expect(await toRecords(await fresh.pull())).toEqual(await toRecords(snapshot));
  // Small LZ manifests and acknowledgement IDs keep their legacy envelope. Message bodies never enter LZ.
  expect(legacy.mock.calls.every(([value]) => JSON.stringify(value).length < 64 * 1024)).toBe(true);
});

it('fails native creation before IDs, folders or outboxes when either gzip constructor is unsupported', async () => {
  for (const name of ['CompressionStream', 'DecompressionStream']) {
    const transport = new MemoryTransport();
    vi.stubGlobal(name, class { constructor() { throw new Error('unsupported format'); } });
    await expect(EncryptedSync.create(transport, 'test-only unavailable passphrase', { wireCompression: 'gzip' }))
      .rejects.toThrow('Native sync gzip is unavailable.');
    expect(transport.next).toBe(0);
    expect(transport.headers.size).toBe(0);
    expect(transport.files.size).toBe(0);
    vi.unstubAllGlobals();
  }
});

it('persists native opt-in across outbox restart and retries immutable ciphertext exactly', async () => {
  const transport = new MemoryTransport(), password = 'test-only native retry passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'gzip' });
  const put = transport.put.bind(transport);
  let lost = true;
  transport.put = async (...args) => {
    await put(...args);
    if (args[2] === 'commit' && lost) { lost = false; throw new Error('response lost'); }
  };
  await expect(session.push(smallSnapshot(), true)).rejects.toThrow('response lost');
  const sent = new Map([...transport.files].map(([id, value]) => [id, value.bytes.slice()]));
  transport.put = put;
  const reader = new EncryptedSync(file.id, transport); await reader.restoreKey();
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  expect((reader as any).options.wireCompression).toBe('gzip');
  for (const [id, bytes] of sent) expect(transport.files.get(id)!.bytes).toEqual(bytes);
  expect([...transport.files.values()].filter(value => value.kind === 'commit')).toHaveLength(1);
});

it.each([false, true])('resumes pack cleanup after a replacement using the opposite hash rule (native=%s)', async native => {
  const transport = new MemoryTransport(), password = 'test-only mixed hash retry passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, native ? { wireCompression: 'gzip' } : { wireCompression: 'legacy' });
  await session.push(smallSnapshot(), true);
  const writerDb = globalThis.indexedDB;
  const remove = transport.remove.bind(transport);
  transport.remove = async () => { throw new Error('cleanup offline'); };
  await expect(session.compactHistory()).rejects.toThrow('cleanup offline');
  const originalPack = [...transport.files].find(([, value]) => value.kind === 'pack')![0];
  transport.remove = remove;
  globalThis.indexedDB = new IDBFactory();
  const other = new EncryptedSync(file.id, transport, native ? { wireCompression: 'legacy' } : { wireCompression: 'gzip' }); await other.unlock(password);
  await other.pull();
  await other.acceptLocal(smallSnapshot());
  const edited = smallSnapshot(); edited.state.defaultSystemMessage = 'after replacement';
  await other.push(edited);
  await other.compactHistory();
  expect(transport.files.has(originalPack)).toBe(false);
  globalThis.indexedDB = writerDb;
  const resumed = new EncryptedSync(file.id, transport); await resumed.restoreKey();
  expect((await resumed.pull()).state.defaultSystemMessage).toBe('after replacement');
  expect([...transport.files.values()].filter(value => value.kind === 'pack')).toHaveLength(1);
});

it('rejects authenticated corrupt native gzip and mismatched canonical pack hashes', async () => {
  const transport = new MemoryTransport(), password = 'test-only native corruption passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'gzip' });
  await session.push(smallSnapshot(), true);
  const internal = session as any;
  const [partId, part] = [...transport.files].find(([, value]) => value.kind === 'part')!;
  const original = part.bytes.slice();
  const bytes = await decrypt(internal.key, part.bytes, internal.context(partId)); bytes[bytes.length - 1] ^= 255;
  part.bytes = await encrypt(internal.key, bytes, internal.context(partId));
  const writerDb = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const fresh = new EncryptedSync(file.id, transport); await fresh.unlock(password);
  await expect(fresh.pull()).rejects.toThrow('Invalid native sync gzip data.');
  expect((fresh as any).remoteCache).toBeUndefined();
  part.bytes = original;
  globalThis.indexedDB = writerDb;
  await session.compactHistory();
  const [packId, pack] = [...transport.files].find(([, value]) => value.kind === 'pack')!;
  const manifest = decode<any>(await decrypt(internal.key, pack.bytes, internal.context(packId)));
  manifest.commits[Object.keys(manifest.commits)[0]] = '0'.repeat(64);
  pack.bytes = await encrypt(internal.key, encode(manifest), internal.context(packId));
  globalThis.indexedDB = new IDBFactory();
  const invalid = new EncryptedSync(file.id, transport); await invalid.unlock(password);
  await expect(invalid.pull()).rejects.toThrow('Sync pack history mismatch.');
});

it.each([false, true])('reads coexisting legacy pack %s and native canonical-hash pack through a fresh client', async wireDelta => {
  const transport = new MemoryTransport(), password = 'test-only coexisting protocol passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy', wireDelta });
  let random = 7;
  const base = Array.from({ length: 18000 }, () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(33 + random % 90);
  }).join('');
  const snapshot = smallSnapshot(), store = snapshot.state.contentStore!;
  const bodies = [base, base.slice(0, 7000) + ' edited ' + base.slice(7008), base.slice(0, 12000) + ' another edit ' + base.slice(12014)];
  const hashes = bodies.map(text => addContent(store, [{ type: 'text', text }]));
  snapshot.state.chats = [{ id: 'chat', title: 'mixed protocol fixture', messages: [], titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    branchTree: { rootId: 'n0', activePath: ['n0'], nodes: Object.fromEntries(hashes.map((contentHash, i) => [`n${i}`,
      { id: `n${i}`, parentId: i ? 'n0' : null, role: 'assistant' as const, contentHash, createdAt: 1 }])) },
  }];
  await session.push(snapshot, true); await session.compactHistory();
  const native = new EncryptedSync(file.id, transport, { wireCompression: 'gzip' }); await native.unlock(password);
  const edited = structuredClone(snapshot);
  // Keep this new group above the conservative grouping bound so the old pack remains a separate immutable file.
  edited.state.defaultSystemMessage = 'Synthetic mixed pack body. '.repeat(35000);
  await native.push(edited); await native.compactHistory();
  const key = (native as any).key;
  const versions = await Promise.all([...transport.files].filter(([, value]) => value.kind === 'pack').map(async ([id, value]) =>
    decode<any>(await decrypt(key, value.bytes, `${file.id}:${id}`)).version));
  expect(versions.sort()).toEqual([wireDelta ? 2 : 1, 3]);
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect(await toRecords(await reader.pull())).toEqual(await toRecords(edited));
});

it('rejects oversized native writes before publishing or persisting a new outbox', async () => {
  const transport = new MemoryTransport(), password = 'test-only native size passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'gzip' });
  const writes = transport.writes.length;
  vi.spyOn(processing, 'encodeNativeAsync').mockImplementation(value => encodeNativeWire(value, 128));
  await expect(session.push(smallSnapshot(), true)).rejects.toThrow('Native sync payload exceeds the byte limit.');
  expect(transport.writes).toHaveLength(writes);
  expect([...transport.files.values()].some(value => value.kind === 'commit' || value.kind === 'part')).toBe(false);
  const metadata = await decodeCache<any>(await decrypt((session as any).key,
    (await cacheStorage.syncCache(file.id))!, `${file.id}:cache`));
  expect(metadata.pending).toBeUndefined();
  expect(metadata.baseline).toBeUndefined();
});

it('keeps the durable reader cursor and baseline unchanged after native expansion limit rejection', async () => {
  const transport = new MemoryTransport(), password = 'test-only native cursor limit passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'gzip' });
  await session.push(smallSnapshot(), true);
  const writerDb = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const readerDb = globalThis.indexedDB;
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  const initial = await reader.pull(); await reader.acceptLocal(initial);
  const durable = (await cacheStorage.syncCache(file.id))!.slice();
  globalThis.indexedDB = writerDb;
  const changed = smallSnapshot(); changed.state.defaultSystemMessage = 'Synthetic larger payload. '.repeat(2000);
  await session.push(changed);
  globalThis.indexedDB = readerDb;
  const decoding = vi.spyOn(processing, 'decodeNativePartsAsync').mockImplementation(parts => decodeNativeParts(parts, 1024));
  await expect(reader.pull()).rejects.toThrow('Native sync payload exceeds the byte limit.');
  expect(await cacheStorage.syncCache(file.id)).toEqual(durable);
  expect((reader as any).remoteCache).toBeUndefined();
  decoding.mockRestore();
  expect((await reader.pull()).state.defaultSystemMessage).toBe(changed.state.defaultSystemMessage);
});

it('explicitly disables native writes after restart while completing the original native outbox unchanged', async () => {
  const transport = new MemoryTransport(), password = 'test-only native opt-out passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'gzip' });
  const put = transport.put.bind(transport);
  let fail = true;
  transport.put = async (...args) => {
    await put(...args);
    if (args[2] === 'commit' && fail) { fail = false; throw new Error('response lost'); }
  };
  await expect(session.push(smallSnapshot(), true)).rejects.toThrow('response lost');
  const sent = new Map([...transport.files].map(([id, value]) => [id, value.bytes.slice()]));
  transport.put = put;
  const reader = new EncryptedSync(file.id, transport, { wireCompression: 'legacy' }); await reader.restoreKey();
  expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
  for (const [id, bytes] of sent) expect(transport.files.get(id)!.bytes).toEqual(bytes);
  const edited = smallSnapshot(); edited.state.defaultSystemMessage = 'legacy update';
  await reader.push(edited);
  const internal = reader as any;
  const [id, commit] = [...transport.files].filter(([, value]) => value.kind === 'commit').at(-1)!;
  expect(decode<any>(await decrypt(internal.key, commit.bytes, internal.context(id))).version).toBe(2);
  const metadata = await decodeCache<any>(await decrypt(internal.key, (await cacheStorage.syncCache(file.id))!, internal.context('cache')));
  expect(metadata.wireCompression).toBe('legacy');
  const restarted = new EncryptedSync(file.id, transport); await restarted.restoreKey();
  expect((await restarted.pull()).state.defaultSystemMessage).toBe('legacy update');
  expect((restarted as any).options.wireCompression).toBe('legacy');
});

it.each([[false, false], [true, false], [false, true], [true, true]])(
  'authenticates reordered native/legacy overlap in either order and rejects changed content (nativeFirst=%s, altered=%s)',
  async (nativeFirst, altered) => {
    const transport = new MemoryTransport(), password = 'test-only reordered pack passphrase';
    const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy' });
    await session.push(smallSnapshot(), true); await session.compactHistory();
    const internal = session as any;
    const legacyId = [...transport.files].find(([, value]) => value.kind === 'pack')![0];
    const legacy = internal.cache.commits;
    const setting = JSON.stringify(['state', 'defaultSystemMessage']);
    const reordered = Object.fromEntries(Object.entries(legacy).map(([id, value]) => {
      const commit = value as any;
      return [id, { changes: commit.changes.map((change: any) => ({ after: altered && change.key === setting
        ? JSON.stringify('different native state') : change.after, key: change.key, before: change.before })),
        parents: commit.parents, version: commit.version }];
    }));
    const [nativeId, part] = await transport.ids(2);
    const payload = await encodeNativeWire({ version: 1, commits: reordered });
    await transport.put(part, file.id, 'pack-part', await encrypt(internal.key, payload, internal.context(part)));
    const manifest = { version: 3, commits: await hashNativeCommits(reordered), parts: [part], bytes: payload.length };
    await transport.put(nativeId, file.id, 'pack', await encrypt(internal.key, encode(manifest), internal.context(nativeId)));
    const packs = nativeFirst ? [nativeId, legacyId] : [legacyId, nativeId];
    transport.history = async () => ({ commits: [], packs });
    transport.packs = async () => packs;
    globalThis.indexedDB = new IDBFactory();
    const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
    if (altered) {
      await expect(reader.pull()).rejects.toThrow('Sync pack history mismatch.');
      return;
    }
    expect((await reader.pull()).state.defaultSystemMessage).toBe('initial');
    const id = Object.keys(legacy)[0], selected = (reader as any).cache.commits[id];
    expect(JSON.stringify(selected)).toBe(JSON.stringify(legacy[id]));
    const [cached] = await cacheStorage.readSyncEntries(file.id, [`commit:${id}`]);
    const decoded = await decodeCache(await decrypt(internal.key, cached!, internal.context(`commit:${id}`)));
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(selected));
  },
);

it('uses uncompressed grouping bounds when folding highly compressed existing native packs', async () => {
  const transport = new MemoryTransport(), password = 'test-only native folding bound passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'gzip' });
  const original = smallSnapshot(); original.state.defaultSystemMessage = 'Synthetic repeated prior pack. '.repeat(35000);
  await session.push(original, true); await session.compactHistory();
  const originalPack = [...transport.files].find(([, value]) => value.kind === 'pack')![0];
  const edited = smallSnapshot(); edited.state.defaultSystemMessage = 'small subsequent change';
  await session.push(edited); await session.compactHistory();
  // Compressed sizes are tiny, but folding the old logical body would exceed the native grouping bound.
  expect(transport.files.has(originalPack)).toBe(true);
  expect([...transport.files.values()].filter(value => value.kind === 'pack')).toHaveLength(2);
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport); await reader.unlock(password);
  expect((await reader.pull()).state.defaultSystemMessage).toBe('small subsequent change');
});

it.each(['valid', 'missing', 'corrupt'])('resumes reordered legacy cleanup from its immutable outbox, failing closed for %s outbox data', async variant => {
  const transport = new MemoryTransport(), password = 'test-only reordered legacy cleanup passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy' });
  await session.push(smallSnapshot(), true);
  const remove = transport.remove.bind(transport);
  transport.remove = async () => { throw new Error('cleanup offline'); };
  await expect(session.compactHistory()).rejects.toThrow('cleanup offline');
  transport.remove = remove;
  const internal = session as any;
  const [oldId, oldFile] = [...transport.files].find(([, value]) => value.kind === 'pack')!;
  const oldManifest = decode<any>(await decrypt(internal.key, oldFile.bytes, internal.context(oldId)));
  const [oldPart] = oldManifest.parts;
  const oldPayload = decode<any>(await decrypt(internal.key, transport.files.get(oldPart)!.bytes, internal.context(oldPart)));
  const commits = Object.fromEntries(Object.entries(oldPayload.commits).map(([id, value]) => {
    const commit = value as any;
    return [id, { changes: commit.changes.map((change: any) => ({ after: change.after, key: change.key, before: change.before })),
      parents: commit.parents, version: commit.version }];
  }));
  const [replacement, part] = await transport.ids(2);
  const payload = encode({ version: 1, commits });
  const hashes: Record<string, string> = {};
  for (const [id, commit] of Object.entries(commits)) hashes[id] = await digest(encode(commit));
  expect(hashes).not.toEqual(oldManifest.commits);
  await transport.put(part, file.id, 'pack-part', await encrypt(internal.key, payload, internal.context(part)));
  const manifest = { version: 1, commits: hashes, parts: [part], bytes: payload.length };
  await transport.put(replacement, file.id, 'pack', await encrypt(internal.key, encode(manifest), internal.context(replacement)));
  await remove(oldId); await remove(oldPart);
  const ciphertext = transport.files.get(replacement)!.bytes.slice();
  // Persist the replacement representation, then fail cleanup again before the old pending record is removed.
  transport.remove = async () => { throw new Error('cleanup still offline'); };
  const retry = new EncryptedSync(file.id, transport); await retry.restoreKey();
  await expect(retry.pull()).rejects.toThrow('cleanup still offline');
  transport.remove = remove;
  if (variant === 'missing') await cacheStorage.writeSyncCache(file.id, undefined, [], [`outbox:${oldPart}`]);
  if (variant === 'corrupt') {
    const [bytes] = await cacheStorage.readSyncEntries(file.id, [`outbox:${oldPart}`]);
    const damaged = bytes!.slice(); damaged[damaged.length - 1] ^= 255;
    await cacheStorage.writeSyncCache(file.id, undefined, [[`outbox:${oldPart}`, damaged]]);
  }
  const resumed = new EncryptedSync(file.id, transport); await resumed.restoreKey();
  if (variant === 'valid') expect((await resumed.pull()).state.defaultSystemMessage).toBe('initial');
  else await expect(resumed.pull()).rejects.toThrow(variant === 'missing' ? 'Missing local upload data.' : 'Unable to decrypt sync data');
  expect([...transport.files.values()].filter(value => value.kind === 'pack')).toHaveLength(1);
  expect(transport.files.get(replacement)!.bytes).toEqual(ciphertext);
});
