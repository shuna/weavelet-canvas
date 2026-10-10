import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EncryptedDriveSync } from './sync';
import { useGoogleSyncProgress, withSyncProgress } from './progress';
import { DriveTransport, DriveNotFoundError, SYNC_FOLDER_TYPE, type DriveFile } from './transport';
import { createKeyEnvelope, decrypt, encrypt, unlockKey, encode, digest } from './crypto';
import { toRecords, fromRecords, diffRecords, sameSnapshot } from './records';
import { BROWSER_LOCAL_SETTINGS, withoutBrowserLocalSettings } from './settings';
import type { Snapshot } from './records';
import * as cacheStorage from './cache';
import { addContent, addContentDelta } from '@utils/contentStore';
import type { ChatInterface } from '@type/chat';

const PASSWORD = 'test-only long passphrase';
const normalizeChange = (event: { fileId: string; file?: DriveFile; removed?: boolean }) => ({
  id: event.fileId, removed: event.removed,
  dataset: event.file?.appProperties?.dataset, kind: event.file?.appProperties?.kind,
});
class FakeDrive {
  next = 0;
  files = new Map<string, { bytes: Uint8Array; metadata: DriveFile }>();
  events: { fileId: string; file?: DriveFile; removed?: boolean }[] = [];
  writes: { id: string; kind: string; bytes: Uint8Array }[] = [];
  reads: string[] = [];
  attempts: string[] = [];
  failKind?: string;
  loseResponse?: string;
  async id() { return `f${++this.next}`; }
  async ids(count: number) { return Array.from({ length: count }, () => `f${++this.next}`); }
  async folder(id: string, headerId: string, name = 'Weavelet encrypted sync'): Promise<DriveFile> {
    const metadata = { id, kind: 'drive#file', name, mimeType: SYNC_FOLDER_TYPE,
      appProperties: { weaveletSync: '1', headerId } };
    this.files.set(id, { bytes: new Uint8Array(), metadata });
    return metadata;
  }
  async keyHeader(id: string) { return this.files.get(id)!.metadata.appProperties!.headerId; }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
    this.attempts.push(id);
    if (this.failKind === kind) throw new Error('network interrupted');
    const old = this.files.get(id);
    if (old) { expect(old.bytes).toEqual(bytes); return; }
    const metadata = { id, kind: 'drive#file', name: `${id}.bin`, mimeType: 'application/octet-stream', appProperties: { dataset, kind } };
    this.files.set(id, { bytes: bytes.slice(), metadata });
    this.events.push({ fileId: id, file: metadata });
    this.writes.push({ id, kind, bytes: bytes.slice() });
    if (this.loseResponse === kind) { this.loseResponse = undefined; throw new Error('response lost'); }
  }
  async read(id: string) {
    this.reads.push(id);
    const file = this.files.get(id);
    if (!file) throw new DriveNotFoundError('404 missing file');
    return file.bytes.slice();
  }
  async startToken() { return String(this.events.length); }
  async history(dataset: string) { return { commits: await this.commits(dataset), packs: await this.packs(dataset) }; }
  async commits(dataset: string) { return [...this.files.values()].filter((f) => f.metadata.appProperties?.dataset === dataset && f.metadata.appProperties.kind === 'commit').map((f) => f.metadata.id); }
  async packs(dataset: string) { return [...this.files.values()].filter(f => f.metadata.appProperties?.dataset === dataset && f.metadata.appProperties.kind === 'pack').map(f => f.metadata.id); }
  async remove(id: string) {
    if (this.files.delete(id)) this.events.push({ fileId: id, removed: true });
  }
  async changes(token: string) { return { token: String(this.events.length), changes: this.events.slice(Number(token)).map(normalizeChange) }; }
  transport() { return this as unknown as DriveTransport; }
}
const snapshot = (image = false): Snapshot => {
  const contentStore = {};
  const hash = addContent(contentStore, [
    { type: 'text', text: 'PRIVATE MESSAGE' },
    ...(image ? [{ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,' + 'aBcdE123'.repeat(120000), detail: 'auto' as const } }] : []),
  ]);
  const chat: ChatInterface = {
    id: 'chat-a', title: 'PRIVATE TITLE', messages: [], titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
    branchTree: { rootId: 'n1', activePath: ['n1'], nodes: { n1: { id: 'n1', parentId: null, role: 'user', contentHash: hash, createdAt: 1 } } },
  };
  return { version: 16, state: { chats: [chat], contentStore, branchClipboard: null, theme: 'dark' } };
};
const cache = () => { (globalThis as any).indexedDB = new IDBFactory(); };
beforeEach(cache);

it('excludes browser layout and proxy usage from uploads and older downloads', async () => {
  const local = snapshot();
  const preferences = {
    hideMenuOptions: true, hideSideMenu: true, menuWidth: 320,
    splitPanelRatio: 0.7, splitPanelSwapped: true, chatActiveView: 'split-horizontal' as const,
    showDebugPanel: true, proxyEnabled: true,
  };
  Object.assign(local.state, preferences, { proxyEndpoint: 'https://proxy.example', proxyAuthToken: 'token' });
  const records = await toRecords(local);
  for (const key of BROWSER_LOCAL_SETTINGS) {
    expect(records).not.toHaveProperty(JSON.stringify(['state', key]));
  }
  expect(await sameSnapshot([local, { ...local, state: { ...local.state, proxyEnabled: false, menuWidth: 200 } }])).toBe(true);
  // Simulate records published by a version that synchronized these preferences.
  for (const key of BROWSER_LOCAL_SETTINGS) records[JSON.stringify(['state', key])] = JSON.stringify(preferences[key]);
  const downloaded = await fromRecords(records);
  const legacy = withoutBrowserLocalSettings(local.state);
  for (const key of BROWSER_LOCAL_SETTINGS) {
    expect(downloaded.state).not.toHaveProperty(key);
    expect(legacy).not.toHaveProperty(key);
    expect(local.state[key]).toEqual(preferences[key]);
  }
  expect(downloaded.state.proxyEndpoint).toBe('https://proxy.example');
  expect(downloaded.state.proxyAuthToken).toBe('token');
});

it('encrypts with fresh nonces, authenticates identity, rejects wrong passwords and tampering', async () => {
  const { envelope, key } = await createKeyEnvelope(PASSWORD, 'dataset');
  const unlocked = await unlockKey(envelope, PASSWORD, 'dataset');
  const plain = new TextEncoder().encode('private content');
  const a = await encrypt(key, plain, 'dataset:file');
  const b = await encrypt(key, plain, 'dataset:file');
  expect(a).not.toEqual(b);
  expect(await decrypt(unlocked, a, 'dataset:file')).toEqual(plain);
  await expect(unlockKey(envelope, 'wrong passphrase', 'dataset')).rejects.toThrow('decrypt');
  await expect(decrypt(key, a, 'another:file')).rejects.toThrow('decrypt');
  a[a.length - 1] ^= 1;
  await expect(decrypt(key, a, 'dataset:file')).rejects.toThrow('decrypt');
});

it('round-trips local branches, clipboard, images and delta content without changing the local format', async () => {
  const state = snapshot(true);
  const store = state.state.contentStore!;
  const hash = addContentDelta(store, [{ type: 'text', text: 'long text '.repeat(500) + 'edit' }],
    addContent(store, [{ type: 'text', text: 'long text '.repeat(500) }]));
  const node = { id: 'n2', parentId: 'n1', role: 'assistant' as const, contentHash: hash, createdAt: 2 };
  state.state.chats![0].branchTree!.nodes.n2 = node;
  state.state.chats![0].branchTree!.activePath.push('n2');
  state.state.branchClipboard = { nodeIds: ['n2'], sourceChat: 'chat-a', nodes: { n2: { ...node } } };
  const records = await toRecords(state);
  const restored = await fromRecords(records);
  expect(await toRecords(restored)).toEqual(records);
  const restoredHash = restored.state.chats![0].branchTree!.nodes.n2.contentHash;
  expect(restored.state.contentStore![restoredHash].refCount).toBe(2);
  expect(restored.state.contentStore![restoredHash].delta).toBeUndefined();
  const renamed = structuredClone(state);
  renamed.state.chats![0].title = 'edited';
  const changes = await diffRecords(records, await toRecords(renamed));
  expect(changes.map((c) => JSON.parse(c.key))).toEqual([['chats', 'chat-a', 'title']]);
  expect(JSON.stringify(changes)).not.toContain('data:image');
});

it('rejects broken content, cyclic branches and unsafe incoming paths', async () => {
  const state = snapshot();
  state.state.contentStore = {};
  await expect(toRecords(state)).rejects.toThrow('Missing');
  const records = await toRecords(snapshot());
  records[JSON.stringify(['chats', 'chat-a', 'branchTree', 'nodes', 'n1', 'parentId'])] = '"n1"';
  await expect(fromRecords(records)).rejects.toThrow('Cyclic');
  await expect(fromRecords({ '["__proto__","polluted"]': 'true' })).rejects.toThrow('path');
  expect(({} as any).polluted).toBeUndefined();
});

it('uploads only a small title delta and downloads only new encrypted packs on subsequent pulls', async () => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  const original = snapshot(true);
  await session.push(original, true);
  const before = drive.writes.length;
  const changed = structuredClone(original);
  changed.state.chats![0].title = 'NEW PRIVATE TITLE';
  await session.push(changed);
  const writes = drive.writes.slice(before);
  expect(writes.map((w) => w.kind)).toEqual(['commit']);
  expect(writes.reduce((sum, w) => sum + w.bytes.length, 0)).toBeLessThan(1500);
  for (const file of drive.files.values()) {
    expect(new TextDecoder().decode(file.bytes)).not.toContain('PRIVATE');
    expect(file.metadata.name).not.toContain('PRIVATE');
  }
  const pulled = await session.pull();
  expect(pulled.state.chats![0].title).toBe('NEW PRIVATE TITLE');
  expect(await toRecords(pulled)).toEqual(await toRecords(changed));
  drive.reads = [];
  await session.pull();
  expect(drive.reads).toEqual([]);
  await session.push(changed);
  expect(drive.writes.length).toBe(before + 1);
  // Another browser reconstructs from encrypted Drive files alone.
  cache();
  const remote = new EncryptedDriveSync(file.id, drive.transport());
  await remote.unlock(PASSWORD);
  expect(await toRecords(await remote.pull())).toEqual(await toRecords(changed));
});

it('does not retransmit images when editing image-bearing message text', async () => {
  const original = snapshot(true);
  const changed = structuredClone(original);
  const node = changed.state.chats![0].branchTree!.nodes.n1;
  const parts = structuredClone(changed.state.contentStore![node.contentHash].content);
  (parts[0] as { text: string }).text = 'text edited';
  node.contentHash = addContent(changed.state.contentStore!, parts);
  const changes = await diffRecords(await toRecords(original), await toRecords(changed));
  expect(changes.some((c) => JSON.parse(c.key)[0] === 'assets')).toBe(false);
  expect(JSON.stringify(changes).length).toBeLessThan(1800);
});

it.each(['part', 'commit'])('resumes after a lost %s response across reload without duplicate publications', async (kind) => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  drive.loseResponse = kind;
  await expect(session.push(snapshot(), true)).rejects.toThrow('response lost');
  const recovered = new EncryptedDriveSync(file.id, drive.transport());
  await recovered.unlock(PASSWORD);
  await recovered.push(snapshot(), true);
  expect(drive.writes.filter((w) => w.kind === 'commit')).toHaveLength(1);
  expect(await toRecords(await recovered.pull())).toEqual(await toRecords(snapshot()));
});

it('never publishes a commit before all encrypted parts are stored', async () => {
  const drive = new FakeDrive();
  const { session } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  drive.failKind = 'part';
  await expect(session.push(snapshot(), true)).rejects.toThrow('interrupted');
  expect(drive.writes.some((w) => w.kind === 'commit')).toBe(false);
  drive.failKind = undefined;
  await session.push(snapshot(), true);
  expect(drive.writes.map((w) => w.kind)).toEqual(['key', 'part', 'commit']);
});

it('preserves disjoint edits from two devices and stops conflicting changes before uploading', async () => {
  const drive = new FakeDrive();
  const dbA = new IDBFactory();
  (globalThis as any).indexedDB = dbA;
  const { session: a, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  const original = snapshot();
  await a.push(original, true);
  const dbB = new IDBFactory();
  (globalThis as any).indexedDB = dbB;
  const b = new EncryptedDriveSync(file.id, drive.transport());
  await b.unlock(PASSWORD);
  await b.acceptLocal(await b.pull());
  (globalThis as any).indexedDB = dbA;
  const changeA = structuredClone(original);
  changeA.state.chats![0].title = 'Device A';
  await a.push(changeA);
  (globalThis as any).indexedDB = dbB;
  const changeB = structuredClone(original);
  changeB.state.theme = 'light';
  await b.push(changeB);
  const combined = await b.pull();
  expect(combined.state.theme).toBe('light');
  expect(combined.state.chats![0].title).toBe('Device A');
  changeB.state.chats![0].title = 'Device B';
  const count = drive.writes.length;
  await expect(b.push(changeB)).rejects.toThrow('conflict');
  expect(drive.writes).toHaveLength(count);
});

it('blocks empty-chat uploads and never advances past damaged ciphertext', async () => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  await session.push(snapshot(), true);
  await expect(session.push({ version: 16, state: { chats: [], contentStore: {} } })).rejects.toThrow('erase all chats');
  const commitId = drive.writes.find((w) => w.kind === 'commit')!.id;
  const encrypted = drive.files.get(commitId)!.bytes;
  const saved = encrypted.slice();
  encrypted[20] ^= 1;
  cache();
  const receiver = new EncryptedDriveSync(file.id, drive.transport());
  await receiver.unlock(PASSWORD);
  await expect(receiver.pull()).rejects.toThrow('decrypt');
  drive.files.get(commitId)!.bytes = saved;
  expect((await receiver.pull()).state.chats).toHaveLength(1);
});

it('splits a large initial upload into bounded encrypted parts without the old full-snapshot size limit', async () => {
  const drive = new FakeDrive();
  const { session } = await EncryptedDriveSync.create(drive.transport(), PASSWORD, { partBytes: 256 * 1024 });
  const large = snapshot();
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const chunks: string[] = [];
  for (let i = 0; i < 8; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(60_000));
    chunks.push(Array.from(bytes, (b) => alphabet[b % alphabet.length]).join(''));
  }
  const text = chunks.join('') + ' compressible text '.repeat(120_000);
  const node = large.state.chats![0].branchTree!.nodes.n1;
  node.contentHash = addContent(large.state.contentStore!, [{ type: 'text', text }]);
  expect(JSON.stringify(large).length).toBeGreaterThan(2_000_000);
  await session.push(large, true);
  const parts = drive.writes.filter((w) => w.kind === 'part');
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((p) => p.bytes.length <= 256 * 1024 + 28)).toBe(true);
  expect(await toRecords(await session.pull())).toEqual(await toRecords(large));
}, 20_000);

it('counts all required commit and part files before reporting download progress', async () => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD, { partBytes: 16 * 1024 });
  const state = snapshot();
  const random = Array.from(crypto.getRandomValues(new Uint8Array(60_000)), n => String.fromCharCode(32 + n % 90)).join('');
  state.state.chats![0].branchTree!.nodes.n1.contentHash = addContent(state.state.contentStore!, [{ type: 'text', text: random }]);
  await session.push(state, true);
  const parts = drive.writes.filter(w => w.kind === 'part').map(w => w.id);
  expect(parts.length).toBeGreaterThan(1);
  cache();
  const receiver = new EncryptedDriveSync(file.id, drive.transport());
  await receiver.unlock(PASSWORD);
  const read = drive.read.bind(drive);
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const secondPart = new Promise<void>(resolve => { reached = resolve; });
  let partReads = 0;
  drive.read = async id => {
    if (parts.includes(id)) {
      if (++partReads === 2) reached();
      await held;
    }
    return read(id);
  };
  const pulling = withSyncProgress(() => receiver.pull());
  try {
    await secondPart;
    expect(useGoogleSyncProgress.getState()).toMatchObject({
      active: true, phase: 'downloading', totalFiles: parts.length + 1, completedFiles: 1,
    });
  } finally { release(); }
  await pulling;
  expect(drive.reads.filter(id => id === drive.writes.find(w => w.kind === 'commit')!.id)).toHaveLength(1);
});

it.each([false, true])('detects genuinely concurrent publications (same field: %s) without losing either commit', async (conflict) => {
  const drive = new FakeDrive();
  const dbA = new IDBFactory();
  (globalThis as any).indexedDB = dbA;
  const { session: a, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  const original = snapshot();
  await a.push(original, true);
  const dbB = new IDBFactory();
  (globalThis as any).indexedDB = dbB;
  const b = new EncryptedDriveSync(file.id, drive.transport());
  await b.unlock(PASSWORD);
  await b.acceptLocal(await b.pull());
  const initialEvents = drive.events.length;
  (globalThis as any).indexedDB = dbA;
  const changeA = structuredClone(original);
  changeA.state.chats![0].title = 'A';
  await a.push(changeA);
  const afterA = drive.events.length;
  (globalThis as any).indexedDB = dbB;
  // Simulate B publishing before it can observe A's commit.
  const changes = drive.changes.bind(drive);
  drive.changes = async (token) => ({ token: String(drive.events.length), changes:
    drive.events.slice(Number(token)).filter((e) => drive.events.indexOf(e) < initialEvents || drive.events.indexOf(e) >= afterA).map(normalizeChange) });
  const changeB = structuredClone(original);
  if (conflict) changeB.state.chats![0].title = 'B';
  else changeB.state.theme = 'light';
  await b.push(changeB);
  drive.changes = changes;
  // A fresh device sees both concurrent branches, regardless of listing order.
  cache();
  const reader = new EncryptedDriveSync(file.id, drive.transport());
  await reader.unlock(PASSWORD);
  if (conflict) await expect(reader.pull()).rejects.toThrow('conflict');
  else {
    const result = await reader.pull();
    expect(result.state.chats![0].title).toBe('A');
    expect(result.state.theme).toBe('light');
  }
  expect(drive.writes.filter((w) => w.kind === 'commit')).toHaveLength(3);
  if (conflict) {
    const resolved = await reader.resolve(original, 'cloud');
    expect(resolved.state.chats!.map(c => c.title).sort()).toEqual(['A', 'B']);
    cache();
    const reloaded = new EncryptedDriveSync(file.id, drive.transport());
    await reloaded.unlock(PASSWORD);
    expect(await toRecords(await reloaded.pull())).toEqual(await toRecords(resolved));
  }

});

it('stops a stale tab when another tab has advanced its shared sync cache', async () => {
  const drive = new FakeDrive();
  const { session: a, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  await a.push(snapshot(), true);
  const b = new EncryptedDriveSync(file.id, drive.transport());
  await b.unlock(PASSWORD);
  await b.pull();
  await expect(a.push(snapshot())).rejects.toThrow('Another tab');
});

it('migrates a legacy encrypted cache/outbox and keeps IDs, ciphertext and completed files', async () => {
  const drive = new FakeDrive();
  const { file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  const header = drive.files.get(file.appProperties!.headerId)!;
  const key = await unlockKey(JSON.parse(new TextDecoder().decode(header.bytes)), PASSWORD, file.id);
  const original = snapshot(true);
  const records = await toRecords(original);
  const commit = { version: 1, parents: [], changes: await diffRecords({}, records) };
  const [id, part] = await drive.ids(2);
  const partBytes = await encrypt(key, encode(commit), `${file.id}:${part}`);
  const commitBytes = await encrypt(key, encode({ version: 1, parts: [part] }), `${file.id}:${id}`);
  await drive.put(part, file.id, 'part', partBytes);
  await cacheStorage.syncCache(file.id, await encrypt(key, encode({ version: 1, commits: {}, pending: {
    id, commit, baseline: records, files: [
      { id: part, kind: 'part', bytes: [...partBytes], sent: true },
      { id, kind: 'commit', bytes: [...commitBytes], sent: false },
    ],
  } }), `${file.id}:cache`));
  const resumed = new EncryptedDriveSync(file.id, drive.transport());
  await resumed.unlock(PASSWORD);
  await resumed.push(original, true);
  expect(drive.attempts.filter(attempt => attempt === part)).toHaveLength(1);
  expect(drive.files.get(id)!.bytes).toEqual(commitBytes);
  expect(await toRecords(await resumed.pull())).toEqual(records);
});

it('awaits both bounded uploads on failure, publishes nothing incomplete and resumes only missing parts', async () => {
  const drive = new FakeDrive();
  const original = snapshot();
  const node = original.state.chats![0].branchTree!.nodes.n1;
  const random = Array.from(crypto.getRandomValues(new Uint8Array(60_000)), n => String.fromCharCode(32 + n % 90)).join('');
  node.contentHash = addContent(original.state.contentStore!, [{ type: 'text', text: random }]);
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD, { partBytes: 16 * 1024, concurrency: 2 });
  const put = drive.put.bind(drive);
  let active = 0, peak = 0, fail = true;
  drive.put = async (id, dataset, kind, bytes) => {
    if (kind !== 'part') return put(id, dataset, kind, bytes);
    active++; peak = Math.max(peak, active);
    const shouldFail = fail; fail = false;
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (shouldFail) throw new Error('interrupted');
      await put(id, dataset, kind, bytes);
    } finally { active--; }
  };
  await expect(session.push(original, true)).rejects.toThrow('interrupted');
  expect(peak).toBe(2); expect(active).toBe(0);
  expect(drive.writes.filter(w => w.kind === 'commit')).toHaveLength(0);
  const completed = drive.writes.filter(w => w.kind === 'part').map(w => w.id);
  expect(completed).toHaveLength(1);
  const readerDb = globalThis.indexedDB;
  cache();
  const reader = new EncryptedDriveSync(file.id, drive.transport());
  await reader.unlock(PASSWORD);
  await expect(reader.pull()).rejects.toThrow('no completed upload');
  (globalThis as any).indexedDB = readerDb;
  const resumed = new EncryptedDriveSync(file.id, drive.transport(), { concurrency: 2 });
  await resumed.unlock(PASSWORD); await resumed.push(original, true);
  for (const id of completed) expect(drive.attempts.filter(attempt => attempt === id)).toHaveLength(1);
  expect(await toRecords(await resumed.pull())).toEqual(await toRecords(original));
});

it('retries an uploaded part with identical ciphertext when its acknowledgement could not be saved', async () => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  const write = cacheStorage.writeSyncCache;
  let fail = true;
  const spy = vi.spyOn(cacheStorage, 'writeSyncCache').mockImplementation(async (id, value, entries, remove) => {
    if (fail && !value && entries?.some(([key]) => key.startsWith('ack:'))) { fail = false; throw new Error('disk failure'); }
    return write(id, value, entries, remove);
  });
  try { await expect(session.push(snapshot(), true)).rejects.toThrow('disk failure'); }
  finally { spy.mockRestore(); }
  const part = drive.writes.find(w => w.kind === 'part')!;
  expect(drive.writes.filter(w => w.kind === 'commit')).toHaveLength(0);
  const resumed = new EncryptedDriveSync(file.id, drive.transport());
  await resumed.unlock(PASSWORD); await resumed.push(snapshot(), true);
  expect(drive.attempts.filter(id => id === part.id)).toHaveLength(2);
  expect(drive.files.get(part.id)!.bytes).toEqual(part.bytes);
  expect(drive.writes.filter(w => w.kind === 'commit')).toHaveLength(1);
});

it('restores a non-extractable key and the previous outbox after reload, and forgets remembered keys on disconnect', async () => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  drive.loseResponse = 'part';
  await expect(session.push(snapshot(), true)).rejects.toThrow('response lost');
  session.close();
  const key = await cacheStorage.rememberedSyncKey(file.id);
  expect(key?.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', key!)).rejects.toThrow();
  const restored = new EncryptedDriveSync(file.id, drive.transport());
  expect(await restored.restoreKey()).toBe(true);
  await restored.push(snapshot(), true);
  expect((await restored.pull()).state.chats![0].title).toBe('PRIVATE TITLE');
  expect(drive.writes.filter(f => f.kind === 'commit')).toHaveLength(1);
  await cacheStorage.forgetSyncKeys();
  expect(await new EncryptedDriveSync(file.id, drive.transport()).restoreKey()).toBe(false);
});

it.each(['merge', 'local', 'cloud'] as const)('resolves a local/cloud conflict using %s without losing immutable content', async mode => {
  const drive = new FakeDrive();
  const dbA = new IDBFactory();
  (globalThis as any).indexedDB = dbA;
  const original = snapshot();
  original.state.folders = { folder: { id: 'folder', name: 'Original', expanded: true, order: 0 } };
  original.state.chats![0].folder = 'folder';
  const { session: a, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  await a.push(original, true);
  const dbB = new IDBFactory();
  (globalThis as any).indexedDB = dbB;
  const b = new EncryptedDriveSync(file.id, drive.transport());
  await b.unlock(PASSWORD);
  await b.acceptLocal(await b.pull());
  const left = structuredClone(original), right = structuredClone(original);
  left.state.chats![0].title = 'Cloud'; left.state.folders!.folder.name = 'Cloud folder';
  right.state.chats![0].title = 'Local'; right.state.folders!.folder.name = 'Local folder';
  (globalThis as any).indexedDB = dbA; await a.push(left);
  (globalThis as any).indexedDB = dbB;
  await expect(b.push(right)).rejects.toThrow('conflict');
  const result = await b.resolve(right, mode);
  const titles = result.state.chats!.map(chat => chat.title).sort();
  expect(titles).toEqual(mode === 'merge' ? ['Cloud', 'Local'] : mode === 'local' ? ['Local'] : ['Cloud']);
  if (mode === 'merge') {
    expect(Object.values(result.state.folders!).map(f => f.name).sort()).toEqual(['Cloud folder', 'Local folder']);
    expect(new Set(result.state.chats!.map(c => c.folder)).size).toBe(2);
  }
  await b.acceptLocal(result);
  await b.push(result);
  cache();
  const reader = new EncryptedDriveSync(file.id, drive.transport());
  await reader.unlock(PASSWORD);
  expect(await toRecords(await reader.pull())).toEqual(await toRecords(result));
});

it('preserves both valid branches when deleting a node conflicts with extending it', async () => {
  const drive = new FakeDrive();
  const dbA = new IDBFactory(); (globalThis as any).indexedDB = dbA;
  const original = snapshot();
  const tree = original.state.chats![0].branchTree!;
  tree.nodes.n2 = { ...tree.nodes.n1, id: 'n2', parentId: 'n1' }; tree.activePath.push('n2');
  const { session: a, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  await a.push(original, true);
  const dbB = new IDBFactory(); (globalThis as any).indexedDB = dbB;
  const b = new EncryptedDriveSync(file.id, drive.transport()); await b.unlock(PASSWORD); await b.acceptLocal(await b.pull());
  const remote = structuredClone(original), local = structuredClone(original);
  remote.state.chats![0].branchTree!.nodes.n3 = { ...tree.nodes.n2, id: 'n3', parentId: 'n2' };
  delete local.state.chats![0].branchTree!.nodes.n2; local.state.chats![0].branchTree!.activePath = ['n1'];
  (globalThis as any).indexedDB = dbA; await a.push(remote);
  (globalThis as any).indexedDB = dbB;
  await expect(b.push(local)).rejects.toThrow('conflict');
  const result = await b.resolve(local, 'merge');
  expect(result.state.chats).toHaveLength(1);
  expect(Object.keys(result.state.chats![0].branchTree!.nodes)).toHaveLength(3);
  expect(result.state.chats![0].branchTree!.activePath).toEqual(['n1']);
  await b.acceptLocal(result); await b.push(result);
});

it.each(['title', 'message'])('resumes an interrupted %s merge publication without duplicating preserved data', async kind => {
  const drive = new FakeDrive();
  const dbA = new IDBFactory(); (globalThis as any).indexedDB = dbA;
  const original = snapshot();
  const { session: a, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD); await a.push(original, true);
  const dbB = new IDBFactory(); (globalThis as any).indexedDB = dbB;
  const b = new EncryptedDriveSync(file.id, drive.transport()); await b.unlock(PASSWORD); await b.acceptLocal(await b.pull());
  const remote = structuredClone(original), local = structuredClone(original);
  if (kind === 'title') { remote.state.chats![0].title = 'Cloud'; local.state.chats![0].title = 'Local'; }
  else for (const [state, text] of [[remote, 'Cloud'], [local, 'Local']] as const) {
    state.state.chats![0].branchTree!.nodes.n1.contentHash = addContent(state.state.contentStore!, [{ type: 'text', text }]);
  }
  (globalThis as any).indexedDB = dbA; await a.push(remote);
  (globalThis as any).indexedDB = dbB;
  await expect(b.push(local)).rejects.toThrow('conflict');
  drive.loseResponse = 'commit';
  await expect(b.resolve(local, 'merge')).rejects.toThrow('response lost');
  const count = drive.writes.length;
  const reloaded = new EncryptedDriveSync(file.id, drive.transport()); await reloaded.restoreKey();
  const resolved = await reloaded.resolve(local, 'merge');
  if (kind === 'title') expect(resolved.state.chats!.map(chat => chat.title).sort()).toEqual(['Cloud', 'Local']);
  else {
    expect(resolved.state.chats).toHaveLength(1);
    expect(Object.values(resolved.state.chats![0].branchTree!.nodes)).toHaveLength(2);
  }
  expect(drive.writes).toHaveLength(count);
});


it('creates a named folder and restores its key after a remote rename using the same ID', async () => {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD, { folderName: 'My sync' });
  expect(file.name).toBe('My sync');
  await session.push(snapshot(), true);
  drive.files.get(file.id)!.metadata.name = 'Renamed on Drive';
  const reloaded = new EncryptedDriveSync(file.id, drive.transport());
  expect(await reloaded.restoreKey()).toBe(true);
  expect(await toRecords(await reloaded.pull())).toEqual(await toRecords(snapshot()));
});

// Build real encrypted history without paying for an autosave/replay for every fixture edit.
async function appendHistory(drive: FakeDrive, file: DriveFile, state: Snapshot, parent: string, count: number) {
  const key = (await cacheStorage.rememberedSyncKey(file.id))!;
  for (let i = 0; i < count; i++) {
    const id = await drive.id();
    const before = await digest(JSON.stringify(state.state.chats![0].title));
    state.state.chats![0].title = `revision-${id}`;
    const commit = { version: 2, parents: [parent], changes: [{ key: '["chats","chat-a","title"]', before,
      after: JSON.stringify(state.state.chats![0].title) }] };
    await drive.put(id, file.id, 'commit', await encrypt(key, encode(commit), `${file.id}:${id}`));
    parent = id;
  }
  return parent;
}
async function appendTheme(drive: FakeDrive, file: DriveFile, state: Snapshot, parent: string, theme: NonNullable<Snapshot['state']['theme']>) {
  const key = (await cacheStorage.rememberedSyncKey(file.id))!;
  const id = await drive.id();
  const before = await digest(JSON.stringify(state.state.theme));
  state.state.theme = theme;
  const commit = { version: 2, parents: [parent], changes: [{ key: '["state","theme"]', before, after: JSON.stringify(theme) }] };
  await drive.put(id, file.id, 'commit', await encrypt(key, encode(commit), `${file.id}:${id}`));
}
async function appendPackedTitle(drive: FakeDrive, file: DriveFile, parent: string, title: string) {
  const key = (await cacheStorage.rememberedSyncKey(file.id))!;
  const commitId = await drive.id(), part = await drive.id(), pack = await drive.id();
  const commit = { version: 1, parents: [parent], changes: [{ key: '["chats","chat-a","title"]',
    before: await digest(JSON.stringify(`revision-${parent}`)), after: JSON.stringify(title) }] };
  const payload = encode({ version: 1, commits: { [commitId]: commit } });
  await drive.put(part, file.id, 'pack-part', await encrypt(key, payload, `${file.id}:${part}`));
  const manifest = { version: 1, commits: { [commitId]: await digest(encode(commit)) }, parts: [part], bytes: payload.length };
  await drive.put(pack, file.id, 'pack', await encrypt(key, encode(manifest), `${file.id}:${pack}`));
}
async function retainedHistory(count = 128) {
  const drive = new FakeDrive();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  const original = snapshot(), state = structuredClone(original);
  await session.push(state, true);
  const first = drive.writes.find(w => w.kind === 'commit')!.id;
  const last = await appendHistory(drive, file, state, first, count - 1);
  return { drive, session, file, original, state, last };
}

it('compacts at 128 commits, retains exact history and skips pack payloads for cached readers', async () => {
  const { drive, session, file, state, last } = await retainedHistory(127);
  await session.push(state, true);
  expect(await drive.commits(file.id)).toHaveLength(127);
  expect(await drive.packs(file.id)).toHaveLength(0);
  await appendHistory(drive, file, state, last, 1);
  const writerDb = globalThis.indexedDB;
  cache();
  const cachedDb = globalThis.indexedDB;
  const cached = new EncryptedDriveSync(file.id, drive.transport());
  await cached.unlock(PASSWORD);
  const beforeReads = drive.reads.length;
  expect(await toRecords(await cached.pull())).toEqual(await toRecords(state));
  expect(drive.reads.length - beforeReads).toBe(129); // 128 commits plus the initial multipart data.
  await cached.acceptLocal(state);
  (globalThis as any).indexedDB = writerDb;
  const before = drive.writes.length;
  await session.push(state, true);
  const writes = drive.writes.slice(before);
  expect(writes.map(w => w.kind)).toEqual(['pack-part', 'pack']);
  expect(await drive.commits(file.id)).toHaveLength(0);
  expect([...drive.files.values()].filter(f => f.metadata.appProperties?.kind === 'part')).toHaveLength(0);
  const packs = await drive.packs(file.id);
  expect(packs).toHaveLength(1);
  expect(writes.every(w => w.bytes.length <= 4 * 1024 * 1024)).toBe(true);
  (globalThis as any).indexedDB = cachedDb;
  drive.reads = [];
  expect(await toRecords(await cached.pull())).toEqual(await toRecords(state));
  expect(drive.reads).toEqual(packs); // Index only: no retransmission of known history.
  drive.reads = [];
  await cached.pull();
  expect(drive.reads).toEqual([]);
  cache();
  const fresh = new EncryptedDriveSync(file.id, drive.transport());
  await fresh.unlock(PASSWORD);
  drive.reads = [];
  expect(await toRecords(await fresh.pull())).toEqual(await toRecords(state));
  expect(drive.reads).toHaveLength(2); // One index plus one payload instead of 129 media requests.
}, 30_000);

it.each(['pack-part', 'pack', 'delete'])('resumes compaction after a lost %s response without changing ciphertext or losing history', async failure => {
  const { drive, session, file, state } = await retainedHistory();
  if (failure === 'delete') {
    const remove = drive.remove.bind(drive);
    let fail = true;
    drive.remove = async id => { await remove(id); if (fail) { fail = false; throw new Error('response lost'); } };
  } else drive.loseResponse = failure;
  await expect(session.push(state, true)).rejects.toThrow('response lost');
  if (failure !== 'delete') expect(await drive.commits(file.id)).toHaveLength(128);
  const prepared = drive.writes.filter(w => w.kind.startsWith('pack'));
  const resumed = new EncryptedDriveSync(file.id, drive.transport());
  expect(await resumed.restoreKey()).toBe(true);
  expect(await toRecords(await resumed.pull())).toEqual(await toRecords(state));
  expect(await drive.commits(file.id)).toHaveLength(0);
  expect(await drive.packs(file.id)).toHaveLength(1);
  for (const file of prepared) expect(drive.files.get(file.id)!.bytes).toEqual(file.bytes);
  expect(drive.writes.filter(w => w.kind === 'pack-part')).toHaveLength(1);
  expect(drive.writes.filter(w => w.kind === 'pack')).toHaveLength(1);
}, 30_000);

it('never deletes sources when pack readback authentication fails', async () => {
  const { drive, session, file, state } = await retainedHistory();
  const read = drive.read.bind(drive);
  let damage = true;
  drive.read = async id => {
    const bytes = await read(id);
    if (damage && drive.files.get(id)?.metadata.appProperties?.kind === 'pack-part') bytes[20] ^= 1;
    return bytes;
  };
  await expect(session.push(state, true)).rejects.toThrow('decrypt');
  expect(await drive.commits(file.id)).toHaveLength(128);
  damage = false;
  expect(await toRecords(await session.pull())).toEqual(await toRecords(state));
  expect(await drive.commits(file.id)).toHaveLength(0);
}, 30_000);

it('rejects an externally listed conflicting pack before compaction deletes sources', async () => {
  const { drive, session, file, state, last } = await retainedHistory();
  const local = structuredClone(state);
  local.state.chats![0].title = 'local packed edit';
  const read = drive.read.bind(drive);
  let injected = false, deleted = 0;
  drive.read = async id => {
    const bytes = await read(id);
    if (!injected && drive.files.get(id)?.metadata.appProperties?.kind === 'pack') {
      injected = true;
      await appendPackedTitle(drive, file, last, 'external packed edit');
    }
    return bytes;
  };
  const remove = drive.remove.bind(drive);
  drive.remove = async id => { deleted++; await remove(id); };
  await expect(session.synchronize(local, true)).rejects.toThrow('conflict');
  expect(injected).toBe(true);
  expect(deleted).toBe(0);
}, 30_000);

it.each([false, true])('rechecks history after compaction cleanup sees an external %s-field publication', async conflict => {
  const { drive, session, file, state, last } = await retainedHistory();
  const local = structuredClone(state);
  if (conflict) local.state.chats![0].title = 'local cleanup edit';
  const remove = drive.remove.bind(drive);
  let injected = false;
  drive.remove = async id => {
    if (!injected) {
      injected = true;
      if (conflict) await appendHistory(drive, file, state, last, 1);
      else await appendTheme(drive, file, state, last, 'light');
    }
    await remove(id);
  };
  if (conflict) await expect(session.synchronize(local, true)).rejects.toThrow('conflict');
  else expect((await session.synchronize(local, true)).state.theme).toBe('light');
  expect(injected).toBe(true);
}, 30_000);

it('merges small packs again and lets an offline reader recover through the replacement index', async () => {
  const { drive, session, file, state, last } = await retainedHistory();
  await session.push(state, true);
  const writerDb = globalThis.indexedDB;
  cache();
  const readerDb = globalThis.indexedDB;
  const reader = new EncryptedDriveSync(file.id, drive.transport());
  await reader.unlock(PASSWORD);
  await reader.acceptLocal(await reader.pull());
  const oldPack = (await drive.packs(file.id))[0];
  (globalThis as any).indexedDB = writerDb;
  await appendHistory(drive, file, state, last, 128);
  await session.push(state, true);
  expect(await drive.packs(file.id)).toHaveLength(1);
  expect(drive.files.has(oldPack)).toBe(false);
  (globalThis as any).indexedDB = readerDb;
  // These new commits require a payload once; a later replacement containing only known entries does not.
  expect(await toRecords(await reader.pull())).toEqual(await toRecords(state));
  drive.reads = [];
  await reader.pull();
  expect(drive.reads).toEqual([]);
  cache();
  const fresh = new EncryptedDriveSync(file.id, drive.transport());
  await fresh.unlock(PASSWORD);
  expect(await toRecords(await fresh.pull())).toEqual(await toRecords(state));
}, 30_000);

it('preserves offline disjoint edits and still rejects conflicting edits after source deletion', async () => {
  const { drive, session, file, state, original } = await retainedHistory();
  const writerDb = globalThis.indexedDB;
  cache();
  const offlineDb = globalThis.indexedDB;
  const offline = new EncryptedDriveSync(file.id, drive.transport());
  await offline.unlock(PASSWORD);
  await offline.acceptLocal(original);
  (globalThis as any).indexedDB = writerDb;
  await session.push(state, true);
  (globalThis as any).indexedDB = offlineDb;
  const local = structuredClone(original);
  local.state.theme = 'light';
  await offline.push(local);
  const combined = await offline.pull();
  expect(combined.state.theme).toBe('light');
  expect(combined.state.chats![0].title).toBe(state.state.chats![0].title);
  local.state.chats![0].title = 'offline edit';
  const before = drive.writes.length;
  await expect(offline.push(local)).rejects.toThrow('conflict');
  expect(drive.writes).toHaveLength(before);
}, 30_000);

it('recovers a source-part deletion race through the live pack index', async () => {
  const { drive, session, file, state } = await retainedHistory();
  const writerDb = globalThis.indexedDB;
  cache();
  const readerDb = globalThis.indexedDB;
  const reader = new EncryptedDriveSync(file.id, drive.transport());
  await reader.unlock(PASSWORD);
  const read = drive.read.bind(drive);
  let race = true;
  drive.read = async id => {
    if (race && drive.files.get(id)?.metadata.appProperties?.kind === 'part') {
      race = false;
      (globalThis as any).indexedDB = writerDb;
      await session.push(state, true);
      (globalThis as any).indexedDB = readerDb;
    }
    return read(id);
  };
  // Independent devices have separate lock managers; this fixture shares Node's global navigator.
  vi.stubGlobal('navigator', { locks: undefined });
  try { expect(await toRecords(await reader.pull())).toEqual(await toRecords(state)); }
  finally { vi.unstubAllGlobals(); }
}, 30_000);

it('continues to stop on uncovered history deletion', async () => {
  const { drive, session, file, state, last } = await retainedHistory(2);
  await session.pull();
  await drive.remove(last);
  await expect(session.pull()).rejects.toThrow('history was deleted');
  expect(await drive.packs(file.id)).toHaveLength(0);
});

it('resumes cleanup when another device has already replaced its published pack', async () => {
  const { drive, session, file, state, last } = await retainedHistory();
  const writerDb = globalThis.indexedDB;
  const remove = drive.remove.bind(drive);
  let fail = true;
  drive.remove = async id => {
    await remove(id);
    if (fail) { fail = false; throw new Error('delete response lost'); }
  };
  await expect(session.push(state, true)).rejects.toThrow('response lost');
  const originalPack = (await drive.packs(file.id))[0];
  cache();
  const other = new EncryptedDriveSync(file.id, drive.transport());
  await other.unlock(PASSWORD);
  await appendHistory(drive, file, state, last, 128);
  await other.push(state, true);
  expect(drive.files.has(originalPack)).toBe(false);
  (globalThis as any).indexedDB = writerDb;
  const resumed = new EncryptedDriveSync(file.id, drive.transport());
  await resumed.restoreKey();
  expect(await toRecords(await resumed.pull())).toEqual(await toRecords(state));
  expect(await drive.commits(file.id)).toHaveLength(0);
  expect(await drive.packs(file.id)).toHaveLength(1);
}, 30_000);

it('keeps simultaneously published packs safe and consolidates their duplicate history later', async () => {
  const { drive, session, file, state, last } = await retainedHistory();
  const writerDb = globalThis.indexedDB;
  cache();
  const otherDb = globalThis.indexedDB;
  const other = new EncryptedDriveSync(file.id, drive.transport());
  await other.unlock(PASSWORD);
  await other.acceptLocal(await other.pull());
  (globalThis as any).indexedDB = writerDb;
  const put = drive.put.bind(drive);
  let overlap = true;
  drive.put = async (id, dataset, kind, bytes) => {
    if (overlap && kind === 'pack') {
      overlap = false;
      (globalThis as any).indexedDB = otherDb;
      try { await other.push(state); }
      finally { (globalThis as any).indexedDB = writerDb; }
    }
    return put(id, dataset, kind, bytes);
  };
  vi.stubGlobal('navigator', { locks: undefined });
  try { await session.push(state, true); }
  finally { vi.unstubAllGlobals(); }
  expect(await drive.packs(file.id)).toHaveLength(2);
  expect(await drive.commits(file.id)).toHaveLength(0);
  await appendHistory(drive, file, state, last, 128);
  await session.push(state, true);
  expect(await drive.packs(file.id)).toHaveLength(1);
  cache();
  const reader = new EncryptedDriveSync(file.id, drive.transport());
  await reader.unlock(PASSWORD);
  expect(await toRecords(await reader.pull())).toEqual(await toRecords(state));
}, 30_000);


it('manually compacts below the automatic threshold and preserves the exact snapshot', async () => {
  const { drive, session, file, state } = await retainedHistory(3);
  const before = await toRecords(await session.pull());
  await session.compactHistory();
  expect(await drive.commits(file.id)).toHaveLength(0);
  expect(await drive.packs(file.id)).toHaveLength(1);
  expect(await toRecords(await session.pull())).toEqual(before);
  cache();
  const fresh = new EncryptedDriveSync(file.id, drive.transport());
  await fresh.unlock(PASSWORD);
  expect(await toRecords(await fresh.pull())).toEqual(await toRecords(state));
});

it('Drive-only import preserves remote chats, settings and the local sync baseline', async () => {
  const drive = new FakeDrive();
  const local = snapshot();
  const { session, file } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
  await session.push(local, true);
  const imported = snapshot();
  imported.state.chats![0].id = 'imported-chat';
  imported.state.chats![0].title = 'Imported';
  delete imported.state.theme;
  await session.importSnapshot(imported);
  expect(local.state.chats).toHaveLength(1);
  let result = await session.pull();
  expect(result.state.chats!.map(chat => chat.id).sort()).toEqual(['chat-a', 'imported-chat']);
  expect(result.state.theme).toBe('dark');
  // Unchanged local data must not erase the import on the next automatic upload.
  await session.push(local);
  expect((await session.pull()).state.chats).toHaveLength(2);
  cache();
  const fresh = new EncryptedDriveSync(file.id, drive.transport());
  await fresh.unlock(PASSWORD);
  expect((await fresh.pull()).state.chats).toHaveLength(2);
});
