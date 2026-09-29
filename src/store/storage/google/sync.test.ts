import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EncryptedDriveSync } from './sync';
import { DriveTransport, SYNC_FOLDER_TYPE, type DriveFile } from './transport';
import { createKeyEnvelope, decrypt, encrypt, unlockKey } from './crypto';
import { toRecords, fromRecords, diffRecords } from './records';
import type { Snapshot } from './records';
import { addContent, addContentDelta } from '@utils/contentStore';
import type { ChatInterface } from '@type/chat';

const PASSWORD = 'test-only long passphrase';
class FakeDrive {
  next = 0;
  files = new Map<string, { bytes: Uint8Array; metadata: DriveFile }>();
  events: { fileId: string; file: DriveFile }[] = [];
  writes: { id: string; kind: string; bytes: Uint8Array }[] = [];
  reads: string[] = [];
  failKind?: string;
  loseResponse?: string;
  async id() { return `f${++this.next}`; }
  async folder(id: string, headerId: string): Promise<DriveFile> {
    const metadata = { id, kind: 'drive#file', name: 'Weavelet encrypted sync', mimeType: SYNC_FOLDER_TYPE,
      appProperties: { weaveletSync: '1', headerId } };
    this.files.set(id, { bytes: new Uint8Array(), metadata });
    return metadata;
  }
  async metadata(id: string) { return this.files.get(id)!.metadata; }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
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
    if (!file) throw new Error('404 missing file');
    return file.bytes.slice();
  }
  async startToken() { return String(this.events.length); }
  async commits(dataset: string) { return [...this.files.values()].filter((f) => f.metadata.appProperties?.dataset === dataset && f.metadata.appProperties.kind === 'commit').map((f) => f.metadata.id); }
  async changes(token: string) { return { token: String(this.events.length), changes: this.events.slice(Number(token)) }; }
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
  expect(writes.map((w) => w.kind)).toEqual(['part', 'commit']);
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
  expect(drive.writes.length).toBe(before + 2);
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
  const { session } = await EncryptedDriveSync.create(drive.transport(), PASSWORD);
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
    drive.events.slice(Number(token)).filter((e) => drive.events.indexOf(e) < initialEvents || drive.events.indexOf(e) >= afterA) });
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
