import { createKeyEnvelope, unlockKey, encode, decode, encrypt, decrypt, digest, type KeyEnvelope } from './crypto';
import { toRecords, fromRecords, diffRecords, applyChanges, type Records, type Snapshot, type Change } from './records';
import { DriveTransport, SYNC_FOLDER_TYPE, type DriveFile } from './transport';
import { syncCache } from './cache';

interface Commit { version: 1; parents: string[]; changes: Change[] }
interface Pending {
  id: string;
  commit: Commit;
  baseline: Records;
  files: { id: string; kind: string; bytes: number[]; sent: boolean }[];
}
interface Cache {
  version: 1;
  commits: Record<string, Commit>;
  token?: string;
  baseline?: Records;
  pending?: Pending;
}
const emptyCache = (): Cache => ({ version: 1, commits: {} });
const PART_BYTES = 256 * 1024;

export class EncryptedDriveSync {
  private cache: Cache = emptyCache();
  private key?: CryptoKey;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private cacheFingerprint?: string;
  private loading = new Set<string>();
  constructor(readonly dataset: string, private drive: DriveTransport) {}

  private context(id: string) { return `${this.dataset}:${id}`; }
  private requireKey(): CryptoKey {
    if (!this.key || this.closed) throw new Error('Unlock Google sync with your passphrase first.');
    return this.key;
  }
  close() { this.closed = true; this.key = undefined; }
  private async save() {
    const bytes = await encrypt(this.requireKey(), encode(this.cache), this.context('cache'));
    await syncCache(this.dataset, bytes);
    this.cacheFingerprint = await digest(bytes);
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    const task = async () => {
      const guarded = async () => {
        this.requireKey();
        // Reload under a cross-tab lock so one tab cannot discard another tab's outbox/baseline.
        const cached = await syncCache(this.dataset);
        if (cached) {
          const fingerprint = await digest(cached);
          if (this.cacheFingerprint && this.cacheFingerprint !== fingerprint) {
            throw new Error('Another tab changed the sync state. Reload this tab before resuming.');
          }
          this.cacheFingerprint = fingerprint;
          this.cache = decode<Cache>(await decrypt(this.requireKey(), cached, this.context('cache')));
          if (this.cache.version !== 1) throw new Error('Unsupported local sync cache.');
        }
        return work();
      };
      return typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`weavelet-google-sync:${this.dataset}`, guarded)
        : guarded();
    };
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  static async create(drive: DriveTransport, password: string): Promise<{ session: EncryptedDriveSync; file: DriveFile }> {
    // Derive the key before creating remote files, so invalid passphrases cannot create empty folders.
    const dataset = await drive.id();
    const { key, envelope } = await createKeyEnvelope(password, dataset);
    const header = await drive.id();
    const file = await drive.folder(dataset, header);
    await drive.put(header, dataset, 'key', new TextEncoder().encode(JSON.stringify(envelope)));
    const session = new EncryptedDriveSync(dataset, drive);
    session.key = key;
    await session.save();
    return { session, file };
  }
  async unlock(password: string): Promise<void> {
    const file = await this.drive.metadata(this.dataset);
    if (file.mimeType !== SYNC_FOLDER_TYPE || file.appProperties?.weaveletSync !== '1' || !file.appProperties.headerId) {
      throw new Error('Legacy sync files are read-only. Create a new encrypted sync folder.');
    }
    const envelope = JSON.parse(new TextDecoder().decode(await this.drive.read(file.appProperties.headerId))) as KeyEnvelope;
    this.key = await unlockKey(envelope, password, this.dataset);
    this.closed = false;
  }

  private async loadCommit(id: string): Promise<void> {
    if (this.cache.commits[id]) return;
    if (this.loading.has(id)) throw new Error('Cyclic sync history.');
    this.loading.add(id);
    try {
    const manifest = decode<{ version: number; parts: string[] }>(await decrypt(
      this.requireKey(), await this.drive.read(id), this.context(id)
    ));
    if (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length ||
        manifest.parts.some((p) => typeof p !== 'string')) throw new Error('Invalid sync commit.');
    const chunks = [];
    let size = 0;
    for (const part of manifest.parts) {
      const bytes = await decrypt(this.requireKey(), await this.drive.read(part), this.context(part));
      chunks.push(bytes); size += bytes.length;
    }
    const payload = new Uint8Array(size);
    let offset = 0;
    for (const bytes of chunks) { payload.set(bytes, offset); offset += bytes.length; }
    const commit = decode<Commit>(payload);
    if (commit.version !== 1 || !Array.isArray(commit.parents) || !Array.isArray(commit.changes) ||
        commit.parents.some((p) => typeof p !== 'string' || p === id)) throw new Error('Invalid sync commit.');
    // Load parents even if Drive's changes feed has not exposed them yet.
    for (const parent of commit.parents) await this.loadCommit(parent);
    this.cache.commits[id] = commit;
    } finally { this.loading.delete(id); }
  }

  private async refresh(): Promise<void> {
    if (!this.cache.token) {
      const token = await this.drive.startToken();
      for (const id of await this.drive.commits(this.dataset)) await this.loadCommit(id);
      this.cache.token = token;
    }
    const page = await this.drive.changes(this.cache.token!);
    for (const change of page.changes) {
      if ((change.removed || change.file?.trashed) && (this.cache.commits[change.fileId] || change.fileId === this.dataset)) {
        throw new Error('Sync history was deleted from Drive; sync stopped.');
      }
      if (change.file?.appProperties?.dataset === this.dataset && change.file.appProperties.kind === 'commit' &&
          !change.removed && !change.file.trashed) await this.loadCommit(change.fileId);
    }
    this.cache.token = page.token;
    // Cursor and downloaded commits are committed together. Failed reads never advance the durable cursor.
    await this.save();
  }
  private heads(): string[] {
    const parents = new Set(Object.values(this.cache.commits).flatMap((c) => c.parents));
    return Object.keys(this.cache.commits).filter((id) => !parents.has(id)).sort();
  }
  private async remote(): Promise<Records> {
    // ponytail: replay retained commits; add checkpoint compaction when history replay becomes costly.
    const histories = new Map<string, { id: string; value: string | null }[]>();
    const ancestors = new Map<string, Set<string>>();
    const remaining = new Set(Object.keys(this.cache.commits).sort());
    const latest = (versions: { id: string; value: string | null }[]) =>
      versions.filter((v) => !versions.some((other) => ancestors.get(other.id)?.has(v.id)));
    const valueOf = (versions: { value: string | null }[]) => {
      const values = new Set(versions.map((v) => v.value));
      if (values.size > 1) throw new Error('Concurrent edits conflict. Sync stopped; both copies are preserved.');
      return versions[0]?.value ?? null;
    };
    while (remaining.size) {
      let progress = false;
      for (const id of remaining) {
        const commit = this.cache.commits[id];
        if (!commit.parents.every((p) => ancestors.has(p))) continue;
        const preceding = new Set(commit.parents);
        for (const parent of commit.parents) for (const ancestor of ancestors.get(parent)!) preceding.add(ancestor);
        ancestors.set(id, preceding);
        const keys = new Set<string>();
        for (const change of commit.changes) {
          if (!change || typeof change.key !== 'string' || keys.has(change.key)) throw new Error('Invalid sync change.');
          keys.add(change.key);
          const history = histories.get(change.key) ?? [];
          const parentValue = valueOf(latest(history.filter((v) => preceding.has(v.id))));
          await applyChanges(parentValue === null ? {} : { [change.key]: parentValue }, [change]);
          history.push({ id, value: change.after });
          histories.set(change.key, history);
        }
        remaining.delete(id); progress = true;
      }
      if (!progress) throw new Error('Missing or cyclic sync history.');
    }
    const records: Records = {};
    for (const [key, history] of histories) {
      const value = valueOf(latest(history));
      if (value !== null) records[key] = value;
    }
    return records;
  }
  private async sendPending() {
    const pending = this.cache.pending;
    if (!pending) return;
    for (const file of pending.files) {
      this.requireKey();
      if (file.sent) continue;
      await this.drive.put(file.id, this.dataset, file.kind, new Uint8Array(file.bytes));
      file.sent = true;
      await this.save();
    }
    this.cache.commits[pending.id] = pending.commit;
    this.cache.baseline = pending.baseline;
    delete this.cache.pending;
    await this.save();
  }
  private async prepare(changes: Change[], baseline: Records) {
    const id = await this.drive.id();
    const commit: Commit = { version: 1, parents: this.heads(), changes };
    const payload = encode(commit);
    const files: Pending['files'] = [];
    for (let start = 0; start < payload.length; start += PART_BYTES) {
      const part = await this.drive.id();
      files.push({ id: part, kind: 'part', sent: false,
        bytes: [...await encrypt(this.requireKey(), payload.slice(start, start + PART_BYTES), this.context(part))] });
    }
    files.push({ id, kind: 'commit', sent: false, bytes: [...await encrypt(this.requireKey(),
      encode({ version: 1, parts: files.map((f) => f.id) }), this.context(id))] });
    this.cache.pending = { id, commit, baseline, files };
    // Persist ciphertext and pre-generated IDs before the first upload. A retry sends identical bytes.
    await this.save();
  }

  async push(snapshot: Snapshot, replace = false): Promise<void> {
    const local = await toRecords(snapshot);
    return this.run(async () => {
      await this.sendPending();
      await this.refresh();
      const remote = await this.remote();
      if (!replace && !this.cache.baseline) throw new Error('Choose upload or download before enabling automatic sync.');
      const base = replace ? remote : this.cache.baseline!;
      const changes = (await diffRecords(base, local)).filter((change) => {
        // Content and assets are immutable and may be referenced by another device. Never GC them from a local snapshot.
        const path = JSON.parse(change.key);
        return change.after !== null || (path[0] !== 'content' && path[0] !== 'assets');
      });
      if (snapshot.state.chats?.length === 0 && Object.keys(remote).some((key) => JSON.parse(key)[0] === 'chats' && JSON.parse(key).length > 1)) {
        throw new Error('Cloud sync skipped because the snapshot would erase all chats.');
      }
      const merged = await applyChanges(remote, changes);
      await fromRecords(merged); // Validate references before publishing the commit.
      if (changes.length) {
        await this.prepare(changes, local);
        await this.sendPending();
        await this.refresh();
        await this.remote(); // Detect concurrent conflicting publications; never report them as synced.
      } else {
        this.cache.baseline = local;
        await this.save();
      }
    });
  }

  async pull(): Promise<Snapshot> {
    return this.run(async () => {
      await this.sendPending();
      await this.refresh();
      const records = await this.remote();
      if (!Object.keys(records).length) throw new Error('This encrypted folder has no completed upload yet.');
      return fromRecords(records);
    });
  }
  // Call only after the existing local persistence has accepted the downloaded state.
  async acceptLocal(snapshot: Snapshot): Promise<void> {
    const baseline = await toRecords(snapshot);
    await this.run(async () => { this.cache.baseline = baseline; await this.save(); });
  }
}
