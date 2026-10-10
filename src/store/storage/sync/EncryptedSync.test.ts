import { beforeEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EncryptedSync } from './EncryptedSync';
import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from './transport';
import type { Snapshot } from '../google/records';

class MemoryTransport implements SyncTransport {
  next = 0;
  headers = new Map<string, string>();
  files = new Map<string, { dataset: string; kind: string; bytes: Uint8Array }>();
  events: SyncChange[] = [];
  writes: string[] = [];
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
  async commits(dataset: string) { return this.list(dataset, 'commit'); }
  async packs(dataset: string) { return this.list(dataset, 'pack'); }
  private list(dataset: string, kind: string) {
    return [...this.files].filter(([, file]) => file.dataset === dataset && file.kind === kind).map(([id]) => id);
  }
  async changes(token: string) { return { token: String(this.events.length), changes: this.events.slice(Number(token)) }; }
  async remove(id: string) { if (this.files.delete(id)) this.events.push({ id, removed: true }); }
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

it('shares encrypted delta sync with a non-Drive transport and retries dependencies arriving later', async () => {
  const transport = new MemoryTransport();
  const password = 'test-only shared sync passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  const original: Snapshot = { version: 18, state: { chats: [{
    id: 'chat', title: 'initial', messages: [{ role: 'user', content: [{ type: 'text', text: 'private body' }] }],
    titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  }], contentStore: {}, theme: 'dark' } };
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
  downloaded.state.theme = 'light';
  await reader.push(downloaded);
  expect((await reader.pull()).state.theme).toBe('light');
});

it('downloads without publishing a persisted outbox and discards it only after acceptance', async () => {
  const transport = new MemoryTransport();
  const { session, file } = await EncryptedSync.create(transport, 'test-only shared passphrase');
  const original: Snapshot = { version: 18, state: { theme: 'dark', chats: [], contentStore: {} } };
  await session.push(original, 'if-empty');
  const write = transport.put.bind(transport);
  transport.put = async (...args) => { if (args[2] === 'commit') throw new Error('offline'); return write(...args); };
  await expect(session.push({ ...original, state: { ...original.state, theme: 'light' } })).rejects.toThrow('offline');
  const reader = new EncryptedSync(file.id, transport);
  await reader.restoreKey();
  transport.put = write;
  const count = transport.writes.length;
  const received = await reader.pull(false);
  expect(received.state.theme).toBe('dark');
  expect(transport.writes).toHaveLength(count);
  await reader.acceptLocal(received, true);
  await reader.push(received);
  expect(transport.writes).toHaveLength(count);
  expect((await reader.pull()).state.theme).toBe('dark');
});

it('does not initialize over existing history when another browser has no baseline', async () => {
  const transport = new MemoryTransport();
  const { session, file } = await EncryptedSync.create(transport, 'test-only shared passphrase');
  const original: Snapshot = { version: 18, state: { theme: 'dark', chats: [], contentStore: {} } };
  await session.push(original, 'if-empty');
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock('test-only shared passphrase');
  const count = transport.writes.length;
  await expect(reader.push({ ...original, state: { ...original.state, theme: 'light' } }, 'if-empty')).rejects.toThrow('downloaded');
  expect(transport.writes).toHaveLength(count);
});

it('retains an authenticated replay for an unchanged cursor and drops it after a failed refresh', async () => {
  const transport = new MemoryTransport();
  const { session, file } = await EncryptedSync.create(transport, 'test-only shared passphrase');
  const original: Snapshot = { version: 18, state: { theme: 'dark', chats: [], contentStore: {} } };
  await session.push(original, true);
  await session.pull();
  const replay = (session as any).remoteCache;
  await (session as any).remote();
  expect((session as any).remoteCache.records).toBe(replay.records);
  transport.changes = async token => ({ token, changes: [{ id: 'missing-commit', dataset: file.id, kind: 'commit' }] });
  await expect(session.pull()).rejects.toThrow('not arrived');
  expect((session as any).remoteCache).toBeUndefined();
});
