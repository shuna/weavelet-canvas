import { savedFileSystemTarget } from './handleStore';
import { digest } from '../google/crypto';
import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from '../sync/transport';

export const FILE_SYSTEM_MANIFEST = 'weavelet-sync.json';
const kinds = ['key', 'commit', 'part', 'pack', 'pack-part'] as const;
const validId = (id: string) => /^fs-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
interface Manifest { version: 1; dataset: string; headerId: string }
const missing = (error: unknown) => error instanceof Error && error.name === 'NotFoundError';

export class FileSystemTransport implements SyncTransport {
  // shortcut: retain immutable history because cloud clients can deliver deletes before replacement files, revisit with a client-independent retention protocol.
  readonly supportsCompaction = false;
  constructor(readonly directory: FileSystemDirectoryHandle) {}

  async ids(count: number) { return Array.from({ length: count }, () => `fs-${crypto.randomUUID()}`); }
  async manifest(): Promise<Manifest | undefined> {
    let handle: FileSystemFileHandle;
    try { handle = await this.directory.getFileHandle(FILE_SYSTEM_MANIFEST); }
    catch (error) { if (missing(error)) return; throw error; }
    const file = await handle.getFile();
    if (file.size === 0) return;
    const value = JSON.parse(await file.text());
    if (value?.version !== 1 || !validId(value.dataset) || !validId(value.headerId) || value.dataset === value.headerId) {
      throw new Error('同期フォルダーの情報が不正です。');
    }
    return value;
  }
  async folder(id: string, headerId: string) {
    if (!validId(id) || !validId(headerId)) throw new Error('同期IDが不正です。');
    const saved = await savedFileSystemTarget();
    const resuming = saved?.dataset === id && saved.headerId === headerId && await saved.handle.isSameEntry(this.directory);
    for await (const entry of this.directory.values()) {
      if (entry.name !== '.DS_Store' && !(resuming && (entry.name === FILE_SYSTEM_MANIFEST || entry.name === `${headerId}.key.bin`))) {
        throw new Error('新規保存には空の専用フォルダーを選択してください。');
      }
    }
    await savedFileSystemTarget({ handle: this.directory, dataset: id, headerId, initialized: false });
    await this.write(FILE_SYSTEM_MANIFEST, JSON.stringify({ version: 1, dataset: id, headerId }));
    return { id };
  }
  async keyHeader(dataset: string) {
    const manifest = await this.manifest();
    if (!manifest || manifest.dataset !== dataset) throw new Error('保存先の同期IDが一致しません。');
    return manifest.headerId;
  }
  private async locate(id: string): Promise<FileSystemFileHandle | undefined> {
    if (!validId(id)) throw new Error('同期ファイルIDが不正です。');
    let found: FileSystemFileHandle | undefined;
    for (const kind of kinds) {
      try {
        const handle = await this.directory.getFileHandle(`${id}.${kind}.bin`);
        if (found) throw new Error('同期ファイルIDが重複しています。');
        found = handle;
      } catch (error) { if (!missing(error)) throw error; }
    }
    return found;
  }
  async read(id: string) {
    const handle = await this.locate(id);
    if (!handle) throw new SyncFileNotFoundError('同期ファイルがまだ到着していません。');
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }
  private async write(name: string, bytes: Uint8Array | string) {
    const handle = await this.directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable({ mode: 'exclusive' });
    try {
      const existing = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      const expected = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
      if (existing.length && await digest(existing) !== await digest(expected)) throw new Error('既存の同期ファイルと内容が一致しません。上書きを停止しました。');
      await writer.write(bytes); await writer.close();
    }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
    await this.keyHeader(dataset);
    if (!kinds.some(value => value === kind)) throw new Error('同期ファイル種別が不正です。');
    const existing = await this.locate(id);
    if (existing) {
      const previous = new Uint8Array(await (await existing.getFile()).arrayBuffer());
      if (existing.name !== `${id}.${kind}.bin` || (previous.length && await digest(previous) !== await digest(bytes))) {
        throw new Error('既存の同期ファイルと内容が一致しません。上書きを停止しました。');
      }
      if (previous.length) return;
    }
    await this.write(`${id}.${kind}.bin`, bytes);
  }
  private async scan(): Promise<SyncChange[]> {
    const manifest = await this.manifest();
    if (!manifest) throw new Error('同期フォルダーの情報が見つかりません。');
    const files: SyncChange[] = [];
    const ids = new Set<string>();
    for await (const entry of this.directory.values()) {
      if (!entry.name.endsWith('.bin')) continue;
      const match = /^(fs-[0-9a-f-]{36})\.(key|commit|part|pack|pack-part)\.bin$/.exec(entry.name);
      if (entry.kind !== 'file' || !match || !validId(match[1]) || ids.has(match[1])) throw new Error('同期ファイルに不正な名前または競合コピーがあります。');
      ids.add(match[1]);
      files.push({ id: match[1], dataset: manifest.dataset, kind: match[2] });
    }
    return files.sort((a, b) => a.id.localeCompare(b.id));
  }
  async startToken() { return '[]'; }
  async commits(dataset: string) { await this.keyHeader(dataset); return (await this.scan()).filter(file => file.kind === 'commit').map(file => file.id); }
  async packs(dataset: string) { await this.keyHeader(dataset); return (await this.scan()).filter(file => file.kind === 'pack').map(file => file.id); }
  async changes(token: string) {
    const previous: unknown = JSON.parse(token);
    if (!Array.isArray(previous) || previous.some(id => typeof id !== 'string' || !validId(id))) throw new Error('同期履歴の状態が不正です。');
    const current = await this.scan();
    const ids = new Set(current.map(file => file.id));
    const known = new Set(previous);
    if (previous.some(id => !ids.has(id))) throw new Error('既存の同期ファイルが見つかりません。同期アプリの復元を確認してから再開してください。');
    const changes = current.filter(file => !known.has(file.id));
    return { token: JSON.stringify([...ids]), changes };
  }
  async remove(_id: string): Promise<void> { throw new Error('ファイル同期では履歴を自動削除しません。'); }
}
