import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EncryptedSync } from './EncryptedSync';
import { SyncFileNotFoundError, type SyncTransport, type SyncChange } from './transport';
import { decode, decrypt } from '../google/crypto';
import * as legacyCodec from '../google/crypto';
import { toRecords, type Snapshot } from '../google/records';
import { hashNativeCommits } from '../google/nativeWireCodec';

class ProtocolTransport implements SyncTransport {
  next = 0;
  header = '';
  files = new Map<string, { dataset: string; kind: string; bytes: Uint8Array }>();
  events: SyncChange[] = [];
  loseNextCommit = false;
  async ids(count: number) { return Array.from({ length: count }, () => `protocol-${++this.next}`); }
  async folder(id: string, header: string) { this.header = header; return { id }; }
  async keyHeader() { return this.header; }
  async read(id: string) {
    const file = this.files.get(id);
    if (!file) throw new SyncFileNotFoundError('Missing synthetic protocol file.');
    return file.bytes.slice();
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
    const previous = this.files.get(id);
    if (previous) expect(bytes.every((value, i) => value === previous.bytes[i]) && bytes.length === previous.bytes.length).toBe(true);
    else { this.files.set(id, { dataset, kind, bytes: bytes.slice() }); this.events.push({ id, dataset, kind }); }
    if (kind === 'commit' && this.loseNextCommit) { this.loseNextCommit = false; throw new Error('publication response lost'); }
  }
  async startToken() { return String(this.events.length); }
  async commits(dataset: string) { return [...this.files].filter(([, file]) => file.dataset === dataset && file.kind === 'commit').map(([id]) => id); }
  async packs(dataset: string) { return [...this.files].filter(([, file]) => file.dataset === dataset && file.kind === 'pack').map(([id]) => id); }
  async history(dataset: string) { return { commits: await this.commits(dataset), packs: await this.packs(dataset) }; }
  async changes(token: string) { return { token: String(this.events.length), changes: this.events.slice(Number(token)) }; }
  async remove(id: string) { if (this.files.delete(id)) this.events.push({ id, removed: true }); }
}
const snapshot = (value = 'synthetic initial'): Snapshot => ({ version: 18, state: {
  chats: [], contentStore: {}, defaultSystemMessage: value,
} });
const manifest = async (session: EncryptedSync, transport: ProtocolTransport, id: string) =>
  decode<any>(await decrypt((session as any).key, transport.files.get(id)!.bytes, `${session.dataset}:${id}`));

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('defaults to gzip, bounds inline LZ for small updates and resumes a large gzip outbox without changing its ciphertext', async () => {
  const transport = new ProtocolTransport(), password = 'test-only default gzip passphrase';
  const { session, file } = await EncryptedSync.create(transport, password);
  const legacy = vi.spyOn(legacyCodec, 'encode');
  await session.push(snapshot(), true);
  const [first] = await transport.commits(file.id);
  expect((await manifest(session, transport, first)).version).toBe(4);
  const before = transport.files.size;
  await session.push(snapshot('small edit'));
  const second = (await transport.commits(file.id)).at(-1)!;
  expect((await manifest(session, transport, second)).version).toBe(2);
  expect(transport.files.size - before).toBe(1);
  const large = snapshot('Synthetic long system message. '.repeat(6000));
  transport.loseNextCommit = true;
  await expect(session.push(large)).rejects.toThrow('publication response lost');
  const third = (await transport.commits(file.id)).at(-1)!;
  expect((await manifest(session, transport, third)).version).toBe(4);
  const sent = new Map([...transport.files].map(([id, value]) => [id, value.bytes.slice()]));
  const resumed = new EncryptedSync(file.id, transport); await resumed.restoreKey();
  expect(await toRecords(await resumed.pull())).toEqual(await toRecords(large));
  expect((resumed as any).options.wireCompression).toBe('gzip');
  for (const [id, bytes] of sent) expect(transport.files.get(id)!.bytes.every((value, i) => value === bytes[i])).toBe(true);
  await resumed.compactHistory();
  const [pack] = await transport.packs(file.id), index = await manifest(resumed, transport, pack);
  expect(index.version).toBe(3);
  expect(index.commits).toEqual(await hashNativeCommits((resumed as any).cache.commits));
  expect(Object.keys(index.commits)).toHaveLength(3);
  expect(legacy.mock.calls.every(([value]) => JSON.stringify(value).length <= 64 * 1024)).toBe(true);
  globalThis.indexedDB = new IDBFactory();
  const fresh = new EncryptedSync(file.id, transport); await fresh.unlock(password);
  expect(await toRecords(await fresh.pull())).toEqual(await toRecords(large));
});

it('keeps explicit legacy compression across restart and refuses unavailable gzip before allocating files by default', async () => {
  const transport = new ProtocolTransport(), password = 'test-only explicit legacy passphrase';
  const { session, file } = await EncryptedSync.create(transport, password, { wireCompression: 'legacy' });
  await session.push(snapshot(), true);
  expect((await manifest(session, transport, (await transport.commits(file.id))[0])).version).toBe(1);
  const resumed = new EncryptedSync(file.id, transport); await resumed.restoreKey();
  await resumed.pull(); await resumed.push(snapshot('legacy edit'));
  expect((resumed as any).options.wireCompression).toBe('legacy');
  await resumed.compactHistory();
  expect((await manifest(resumed, transport, (await transport.packs(file.id))[0])).version).toBe(1);
  vi.stubGlobal('CompressionStream', undefined);
  const unavailable = new ProtocolTransport();
  await expect(EncryptedSync.create(unavailable, password)).rejects.toThrow('Native sync gzip is unavailable.');
  expect(unavailable.next).toBe(0);
  expect(unavailable.files.size).toBe(0);
});
