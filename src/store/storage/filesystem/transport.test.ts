import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FileSystemTransport, FILE_SYSTEM_MANIFEST } from './transport';
import { EncryptedSync } from '../sync/EncryptedSync';
import type { Snapshot } from '../google/records';

const saved = vi.hoisted(() => ({ target: undefined as any }));
vi.mock('./handleStore', () => ({ savedFileSystemTarget: async (value?: any) => {
  if (value !== undefined) saved.target = value ?? undefined;
  return saved.target;
} }));

class Directory {
  name = 'sync'; kind = 'directory';
  files = new Map<string, Uint8Array>();
  fail = '';
  async isSameEntry(other: unknown) { return other === this; }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('missing', 'NotFoundError');
      this.files.set(name, new Uint8Array());
    }
    return {
      name, kind: 'file',
      getFile: async () => new Blob([this.files.get(name)!]),
      createWritable: async () => {
        let staged = new Uint8Array();
        return {
          write: async (value: string | Uint8Array) => {
            if (this.fail === name) throw new Error('disk unavailable');
            staged = typeof value === 'string' ? new TextEncoder().encode(value) : value.slice();
          },
          close: async () => { this.files.set(name, staged); },
          abort: async () => {},
        };
      },
    } as unknown as FileSystemFileHandle;
  }
  async *values() { for (const name of this.files.keys()) yield await this.getFileHandle(name); }
  transport() { return new FileSystemTransport(this as unknown as FileSystemDirectoryHandle); }
}
const original: Snapshot = { version: 18, state: { theme: 'dark', contentStore: {}, chats: [] } };
const password = 'test-only folder passphrase';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); saved.target = undefined; });

it('reuses encrypted deltas, catches immutable collisions and detects missing history', async () => {
  const dir = new Directory(), transport = dir.transport();
  const { session, file } = await EncryptedSync.create(transport, password);
  await session.push(original, 'if-empty');
  const initial = await transport.changes('[]');
  await session.push({ ...original, state: { ...original.state, theme: 'light' } });
  const delta = await transport.changes(initial.token);
  expect(delta.changes.filter(change => !change.removed).map(change => change.kind)).toEqual(['commit']);
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, transport);
  await reader.unlock(password);
  expect((await reader.pull()).state.theme).toBe('light');
  const header = await transport.keyHeader(file.id);
  const bytes = await transport.read(header);
  await expect(transport.put(header, file.id, 'key', new Uint8Array([1]))).rejects.toThrow('上書き');
  expect(await transport.read(header)).toEqual(bytes);
  expect(transport.supportsCompaction).toBe(false);
  await expect(transport.remove(header)).rejects.toThrow('自動削除');
  dir.files.delete(`${header}.key.bin`);
  await expect(transport.changes(delta.token)).rejects.toThrow('既存の同期ファイル');
  dir.files.set(`${header}.key.bin`, bytes);
  expect((await transport.changes(delta.token)).changes).toEqual([]);
});

it.each(['manifest', 'key'])('resumes a failed initial %s write with the same dataset and encryption key', async kind => {
  const dir = new Directory();
  if (kind === 'manifest') dir.fail = FILE_SYSTEM_MANIFEST;
  else {
    const originalHandle = dir.getFileHandle.bind(dir);
    dir.getFileHandle = async (name, options) => {
      if (name.endsWith('.key.bin')) dir.fail = name;
      return originalHandle(name, options);
    };
  }
  await expect(EncryptedSync.create(dir.transport(), password)).rejects.toThrow('disk unavailable');
  const target = saved.target;
  expect(target.headerId).toBeTruthy();
  const reader = new EncryptedSync(target.dataset, dir.transport());
  expect(await reader.restoreKey()).toBe(true);
  dir.fail = '';
  if (kind === 'key') dir.getFileHandle = Directory.prototype.getFileHandle.bind(dir);
  await reader.resumeCreation(target.headerId);
  await reader.push(original, 'if-empty');
  expect((await dir.transport().manifest())?.dataset).toBe(target.dataset);
  expect((await reader.pull()).state.theme).toBe('dark');
  // A separate browser can decrypt the recovered header using the original passphrase.
  globalThis.indexedDB = new IDBFactory();
  const other = new EncryptedSync(target.dataset, dir.transport());
  await other.unlock(password);
  expect((await other.pull()).state.theme).toBe('dark');
});

it('rejects nonempty folders and conflict copies without changing existing bytes', async () => {
  const dir = new Directory();
  dir.files.set('personal.txt', new Uint8Array([5]));
  await expect(EncryptedSync.create(dir.transport(), password)).rejects.toThrow('空の専用');
  expect(dir.files.get('personal.txt')).toEqual(new Uint8Array([5]));
  dir.files.clear();
  await EncryptedSync.create(dir.transport(), password);
  dir.files.set('conflicted copy.bin', new Uint8Array([1]));
  await expect(dir.transport().changes('[]')).rejects.toThrow('競合コピー');
});

it('uses set membership for a large unchanged change cursor', async () => {
  const dir = new Directory();
  await EncryptedSync.create(dir.transport(), password);
  const initial = await dir.transport().changes('[]');
  const ids = Array.from({ length: 300 }, (_, index) => `fs-${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`);
  for (const id of ids) dir.files.set(`${id}.part.bin`, new Uint8Array([1]));
  const token = JSON.stringify([...JSON.parse(initial.token), ...ids].sort());
  await expect(dir.transport().changes(token)).resolves.toEqual({ token, changes: [] });
});

it.each(['fragments-first', 'index-first', 'child-first', 'header-last'] as const)(
  'accepts a complete history after out-of-order delivery: %s', async order => {
    const sender = new Directory();
    const { session, file } = await EncryptedSync.create(sender.transport(), password, { partBytes: 16 });
    await session.push(original, 'if-empty');
    const first = new Map(sender.files);
    await session.push({ ...original, state: { ...original.state, theme: 'light' } });
    const receiver = new Directory();
    const deliver = (names: string[]) => { for (const name of names) receiver.files.set(name, sender.files.get(name)!.slice()); };
    const headers = [...first.keys()].filter(name => name === FILE_SYSTEM_MANIFEST || name.endsWith('.key.bin'));
    const parts = [...first.keys()].filter(name => name.endsWith('.part.bin'));
    const parent = [...first.keys()].find(name => name.endsWith('.commit.bin'))!;
    const child = [...sender.files.keys()].find(name => name.endsWith('.commit.bin') && !first.has(name))!;
    expect(parts.length).toBeGreaterThan(1);
    // Isolate the receiving browser's cache from the publishing browser.
    globalThis.indexedDB = new IDBFactory();
    const reader = new EncryptedSync(file.id, receiver.transport());
    if (order === 'header-last') {
      deliver(parts);
      await expect(reader.unlock(password)).rejects.toThrow('同期ID');
      expect(receiver.files.size).toBe(parts.length);
      deliver([parent, child, ...headers]);
      await reader.unlock(password);
    } else {
      deliver(headers);
      await reader.unlock(password);
      if (order === 'fragments-first') {
        deliver(parts);
        await expect(reader.pull(false)).rejects.toThrow('no completed upload');
        // Fragments can already be in the durable cursor when their index arrives.
        deliver([parent, child]);
      } else if (order === 'index-first') {
        deliver([parent, child, parts[0]]);
        await expect(reader.pull(false)).rejects.toThrow('まだ到着');
        deliver(parts.slice(1));
      } else {
        deliver([...parts, child]);
        await expect(reader.pull(false)).rejects.toThrow('まだ到着');
        deliver([parent]);
      }
    }
    expect((await reader.pull(false)).state.theme).toBe('light');
    // Reading never publishes incomplete history or overwrites delivered files.
    for (const [name, bytes] of receiver.files) expect(bytes).toEqual(sender.files.get(name));
    expect(receiver.files.size).toBe(sender.files.size);
  }
);

it('retries a listed but incomplete fragment without accepting an incomplete commit', async () => {
  const sender = new Directory();
  const { session, file } = await EncryptedSync.create(sender.transport(), password, { partBytes: 16 });
  await session.push(original, 'if-empty');
  const receiver = new Directory();
  receiver.files = new Map(sender.files);
  const part = [...receiver.files.keys()].find(name => name.endsWith('.part.bin'))!;
  receiver.files.set(part, new Uint8Array());
  globalThis.indexedDB = new IDBFactory();
  const reader = new EncryptedSync(file.id, receiver.transport());
  await reader.unlock(password);
  await expect(reader.pull(false)).rejects.toThrow();
  receiver.files.set(part, sender.files.get(part)!);
  expect((await reader.pull(false)).state.theme).toBe('dark');
});
