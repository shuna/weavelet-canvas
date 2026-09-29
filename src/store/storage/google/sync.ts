import { SyncConflictError, type Resolution } from './conflicts';
import { mergeSyncRecords } from './merge';
import { encodeAsync } from './encodeAsync';
import { syncPhase, uploadedFile } from './progress';
import { createKeyEnvelope, unlockKey, encode, decode, encrypt, decrypt, digest, type KeyEnvelope } from './crypto';
import { toRecords, fromRecords, hashRecords, diffHashedRecords, applyChanges, type Records, type Snapshot, type Change, diffRecords } from './records';
import { DriveTransport, SYNC_FOLDER_TYPE, type DriveFile } from './transport';
import { syncCache, readSyncEntries, writeSyncCache, rememberedSyncKey } from './cache';

interface Commit { version: 1; parents: string[]; changes: Change[]; resolutions?: Record<string, (string | null)[]> }
interface Pending {
  id: string;
  commit: Commit;
  baseline: Records;
  files: { id: string; kind: string; size: number; bytes?: Uint8Array; sent: boolean }[];
}
interface Cache {
  version: 1;
  commits: Record<string, Commit>;
  token?: string;
  baseline?: Records;
  pending?: Pending;
}
const emptyCache = (): Cache => ({ version: 1, commits: {} });
const PART_BYTES = 1024 * 1024;
const INLINE_BYTES = 256 * 1024;
export interface SyncTransferOptions { partBytes?: number; concurrency?: 1 | 2 }
interface StoredCache {
  version: 2;
  commits: string[];
  token?: string;
  baseline?: Records;
  pending?: { id: string; baseline: Records; files: { id: string; kind: string; size: number }[] };
}

export class EncryptedDriveSync {
  private cache: Cache = emptyCache();
  private key?: CryptoKey;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private cacheFingerprint?: string;
  private remoteConflicts: Record<string, (string | null)[]> = {};
  private loading = new Set<string>();
  private persistedCommits = new Set<string>();
  private encodedCommits = new Map<string, Uint8Array>();
  constructor(readonly dataset: string, private drive: DriveTransport, private options: SyncTransferOptions = {}) {}

  private context(id: string) { return `${this.dataset}:${id}`; }
  private requireKey(): CryptoKey {
    if (!this.key || this.closed) throw new Error('Unlock Google sync with your passphrase first.');
    return this.key;
  }
  close() { this.closed = true; this.key = undefined; }
  private async save(remove: string[] = []) {
    const entries: [string, Uint8Array][] = [];
    const commits = { ...this.cache.commits };
    const pending = this.cache.pending;
    if (pending) commits[pending.id] = pending.commit;
    for (const [id, commit] of Object.entries(commits)) {
      if (this.persistedCommits.has(id)) continue;
      entries.push([`commit:${id}`, await encrypt(this.requireKey(), this.encodedCommits.get(id) ?? encode(commit), this.context(`commit:${id}`))]);
    }
    for (const file of pending?.files ?? []) {
      if (file.bytes) entries.push([`outbox:${file.id}`, file.bytes]);
      if (file.sent) entries.push([`ack:${file.id}`, await encrypt(this.requireKey(), encode(pending!.id), this.context(`ack:${file.id}`))]);
    }
    const stored: StoredCache = {
      version: 2, commits: Object.keys(this.cache.commits), token: this.cache.token, baseline: this.cache.baseline,
      pending: pending && { id: pending.id, baseline: pending.baseline,
        files: pending.files.map(({ id, kind, size }) => ({ id, kind, size })) },
    };
    const bytes = await encrypt(this.requireKey(), encode(stored), this.context('cache'));
    // Publishing the outbox and its immutable ciphertext is one durable transaction.
    await writeSyncCache(this.dataset, bytes, entries, remove);
    for (const id of Object.keys(commits)) { this.persistedCommits.add(id); this.encodedCommits.delete(id); }
    for (const file of pending?.files ?? []) delete file.bytes;
    this.cacheFingerprint = await digest(bytes);
  }
  private async loadCache(bytes: Uint8Array) {
    const stored = decode<StoredCache | Cache>(await decrypt(this.requireKey(), bytes, this.context('cache')));
    if (stored.version === 1) {
      // Upgrade legacy outboxes without regenerating a single ID or ciphertext byte.
      this.cache = stored;
      if (stored.baseline) this.cache.baseline = await hashRecords(stored.baseline);
      if (stored.pending) {
        stored.pending.baseline = await hashRecords(stored.pending.baseline);
        for (const file of stored.pending.files) { file.bytes = new Uint8Array(file.bytes!); file.size = file.bytes.length; }
      }
      await this.save();
      return;
    }
    if (stored.version !== 2 || !Array.isArray(stored.commits)) throw new Error('Unsupported local sync cache.');
    const ids = [...new Set([...stored.commits, ...(stored.pending ? [stored.pending.id] : [])])];
    const values = await readSyncEntries(this.dataset, ids.map(id => `commit:${id}`));
    const commits: Record<string, Commit> = {};
    for (let i = 0; i < ids.length; i++) {
      if (!values[i]) throw new Error('Missing local sync commit.');
      commits[ids[i]] = decode<Commit>(await decrypt(this.requireKey(), values[i]!, this.context(`commit:${ids[i]}`)));
      this.persistedCommits.add(ids[i]);
    }
    this.cache = { version: 1, commits: Object.fromEntries(stored.commits.map(id => [id, commits[id]])), token: stored.token, baseline: stored.baseline,
      pending: stored.pending && { ...stored.pending, commit: commits[stored.pending.id], files: stored.pending.files.map(f => ({ ...f, sent: false })) } };
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
        }
        try {
          if (cached && !this.cacheFingerprint) {
            this.cacheFingerprint = await digest(cached);
            await this.loadCache(cached);
          }
          return await work();
        }
        catch (error) {
          // A failed transaction must be retried from durable state, not half-mutated in-memory metadata.
          this.cacheFingerprint = undefined;
          this.cache = emptyCache(); this.persistedCommits.clear(); this.encodedCommits.clear();
          throw error;
        }
      };
      return typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`weavelet-google-sync:${this.dataset}`, guarded)
        : guarded();
    };
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  static async create(drive: DriveTransport, password: string, options: SyncTransferOptions & { folderName?: string } = {}): Promise<{ session: EncryptedDriveSync; file: DriveFile }> {
    // Derive the key before creating remote files, so invalid passphrases cannot create empty folders.
    const [dataset, header] = await drive.ids(2);
    syncPhase('key');
    const { key, envelope } = await createKeyEnvelope(password, dataset);
    syncPhase('folder');
    const file = await drive.folder(dataset, header, options.folderName);
    await drive.put(header, dataset, 'key', new TextEncoder().encode(JSON.stringify(envelope)));
    const session = new EncryptedDriveSync(dataset, drive, options);
    session.key = key;
    await session.save();
    await rememberedSyncKey(dataset, key);
    return { session, file };
  }
  async unlock(password: string): Promise<void> {
    const file = await this.drive.metadata(this.dataset);
    if (file.mimeType !== SYNC_FOLDER_TYPE || file.appProperties?.weaveletSync !== '1' || !file.appProperties.headerId) {
      throw new Error('Legacy sync files are read-only. Create a new encrypted sync folder.');
    }
    syncPhase('downloading');
    const envelope = JSON.parse(new TextDecoder().decode(await this.drive.read(file.appProperties.headerId))) as KeyEnvelope;
    syncPhase('key');
    this.key = await unlockKey(envelope, password, this.dataset);
    this.closed = false;
    await rememberedSyncKey(this.dataset, this.key);
  }
  async restoreKey(): Promise<boolean> {
    const key = await rememberedSyncKey(this.dataset);
    if (!key) return false;
    if (key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
        (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
      throw new Error('Invalid remembered sync key.');
    }
    this.key = key;
    this.closed = false;
    return true;
  }

  private async loadCommit(id: string): Promise<void> {
    if (this.cache.commits[id]) return;
    if (this.loading.has(id)) throw new Error('Cyclic sync history.');
    this.loading.add(id);
    try {
    syncPhase('downloading');
    const encoded = await decrypt(this.requireKey(), await this.drive.read(id), this.context(id));
    const manifest = decode<{ version: number; parts?: string[]; parents?: string[]; changes?: Change[]; resolutions?: Commit['resolutions'] }>(encoded);
    let payload: Uint8Array;
    let commit: Commit;
    if (manifest.version === 2) {
      commit = { version: 1, parents: manifest.parents!, changes: manifest.changes!, ...(manifest.resolutions ? { resolutions: manifest.resolutions } : {}) };
      payload = encode(commit);
    } else {
      if (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length ||
          manifest.parts.some(p => typeof p !== 'string')) throw new Error('Invalid sync commit.');
      const chunks = [];
      let size = 0;
      for (const part of manifest.parts) {
        const bytes = await decrypt(this.requireKey(), await this.drive.read(part), this.context(part));
        chunks.push(bytes); size += bytes.length;
      }
      payload = new Uint8Array(size);
      let offset = 0;
      for (const bytes of chunks) { payload.set(bytes, offset); offset += bytes.length; }
      commit = decode<Commit>(payload);
    }
    if (commit.version !== 1 || !Array.isArray(commit.parents) || !Array.isArray(commit.changes) ||
        commit.parents.some(p => typeof p !== 'string' || p === id)) throw new Error('Invalid sync commit.');
    this.encodedCommits.set(id, payload);
    // Load parents even if Drive's changes feed has not exposed them yet.
    for (const parent of commit.parents) await this.loadCommit(parent);
    this.cache.commits[id] = commit;
    } finally { this.loading.delete(id); }
  }

  private async refresh(): Promise<void> {
    syncPhase('checking');
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
  private async remote(allowConflicts = false, tips?: string[]): Promise<Records> {
    syncPhase('verifying');
    // ponytail: replay retained commits; add checkpoint compaction when history replay becomes costly.
    const histories = new Map<string, { id: string; value: string | null }[]>();
    const ancestors = new Map<string, Set<string>>();
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      const commit = this.cache.commits[id];
      if (!commit) throw new Error('Missing sync history.');
      reachable.add(id); commit.parents.forEach(visit);
    };
    (tips ?? this.heads()).forEach(visit);
    const remaining = new Set([...reachable].sort());
    const latest = (versions: { id: string; value: string | null }[]) =>
      versions.filter((v) => !versions.some((other) => ancestors.get(other.id)?.has(v.id)));
    const valueOf = (versions: { value: string | null }[]) => {
      const values = new Set(versions.map((v) => v.value));
      if (values.size > 1) throw new SyncConflictError([]);
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
          const parents = latest(history.filter((v) => preceding.has(v.id)));
          let parentValue: string | null;
          if (commit.resolutions?.[change.key]) {
            const expected = [...new Set(await Promise.all(parents.map(v => v.value === null ? null : digest(v.value))))].sort();
            if (expected.length < 2 || JSON.stringify(expected) !== JSON.stringify([...commit.resolutions[change.key]].sort())) {
              throw new Error('Invalid conflict resolution parents.');
            }
            parentValue = parents[0]?.value ?? null;
          } else parentValue = valueOf(parents);
          await applyChanges(parentValue === null ? {} : { [change.key]: parentValue }, [change]);
          history.push({ id, value: change.after });
          histories.set(change.key, history);
        }
        remaining.delete(id); progress = true;
      }
      if (!progress) throw new Error('Missing or cyclic sync history.');
    }
    const records: Records = {};
    const conflicts: Record<string, (string | null)[]> = {};
    for (const [key, history] of histories) {
      const versions = latest(history);
      const values = [...new Set(versions.map(v => v.value))];
      if (values.length > 1) conflicts[key] = await Promise.all(values.map(v => v === null ? null : digest(v)));
      const value = versions[0]?.value ?? null;
      if (value !== null) records[key] = value;
    }
    this.remoteConflicts = conflicts;
    if (!allowConflicts && Object.keys(conflicts).length) throw new SyncConflictError(Object.keys(conflicts));
    return records;
  }
  private async sendPending() {
    const pending = this.cache.pending;
    if (!pending) return;
    const acks = await readSyncEntries(this.dataset, pending.files.map(f => `ack:${f.id}`));
    for (let i = 0; i < acks.length; i++) if (acks[i]) {
      const id = decode<string>(await decrypt(this.requireKey(), acks[i]!, this.context(`ack:${pending.files[i].id}`)));
      if (id !== pending.id) throw new Error('Invalid upload completion record.');
      pending.files[i].sent = true;
    }
    const remaining = pending.files.filter(file => !file.sent);
    syncPhase('uploading', remaining.length, remaining.reduce((total, file) => total + file.size, 0));
    const send = async (file: Pending['files'][number]) => {
      this.requireKey();
      const [bytes] = await readSyncEntries(this.dataset, [`outbox:${file.id}`]);
      if (!bytes || bytes.length !== file.size) throw new Error('Missing local upload data.');
      await decrypt(this.requireKey(), bytes, this.context(file.id));
      await this.drive.put(file.id, this.dataset, file.kind, bytes);
      // Only the tiny authenticated acknowledgement changes after each upload.
      const ack = await encrypt(this.requireKey(), encode(pending.id), this.context(`ack:${file.id}`));
      await writeSyncCache(this.dataset, undefined, [[`ack:${file.id}`, ack]]);
      file.sent = true;
      uploadedFile(file.size);
    };
    const parts = remaining.filter(file => file.kind !== 'commit');
    const concurrency = this.options.concurrency ?? 2;
    for (let i = 0; i < parts.length; i += concurrency) {
      const results = await Promise.allSettled(parts.slice(i, i + concurrency).map(send));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    }
    // The commit is the publication boundary: never publish incomplete data.
    for (const file of remaining.filter(file => file.kind === 'commit')) await send(file);
    syncPhase('saving');
    this.cache.commits[pending.id] = pending.commit;
    this.cache.baseline = pending.baseline;
    delete this.cache.pending;
    await this.save(pending.files.flatMap(f => [`outbox:${f.id}`, `ack:${f.id}`]));
  }
  private async prepare(changes: Change[], baseline: Records, resolutions?: Commit['resolutions']) {
    syncPhase('encrypting');
    const commit: Commit = { version: 1, parents: this.heads(), changes, ...(resolutions ? { resolutions } : {}) };
    const payload = changes.reduce((size, change) => size + (change.after?.length ?? 0), 0) > INLINE_BYTES
      ? await encodeAsync(commit) : encode(commit);
    const inline = commit.parents.length > 0 && payload.length <= INLINE_BYTES;
    const partBytes = this.options.partBytes ?? PART_BYTES;
    const [id, ...parts] = await this.drive.ids(inline ? 1 : 1 + Math.ceil(payload.length / partBytes));
    const files: Pending['files'] = [];
    for (let i = 0; i < parts.length; i++) {
      const bytes = await encrypt(this.requireKey(), payload.slice(i * partBytes, (i + 1) * partBytes), this.context(parts[i]));
      files.push({ id: parts[i], kind: 'part', bytes, size: bytes.length, sent: false });
    }
    const bytes = await encrypt(this.requireKey(), encode(inline ? { ...commit, version: 2 } : { version: 1, parts }), this.context(id));
    files.push({ id, kind: 'commit', bytes, size: bytes.length, sent: false });
    this.encodedCommits.set(id, payload);
    this.cache.pending = { id, commit, baseline, files };
    await this.save();
  }

  async push(snapshot: Snapshot, replace = false): Promise<void> {
    syncPhase('preparing');
    const local = await toRecords(snapshot);
    return this.run(async () => {
      await this.sendPending();
      await this.refresh();
      const remote = await this.remote();
      if (!replace && !this.cache.baseline) throw new Error('Choose upload or download before enabling automatic sync.');
      const base = replace ? await hashRecords(remote) : this.cache.baseline!;
      const localHashes = await hashRecords(local);
      const changes = diffHashedRecords(base, local, localHashes).filter((change) => {
        // Content and assets are immutable and may be referenced by another device. Never GC them from a local snapshot.
        const path = JSON.parse(change.key);
        return change.after !== null || (path[0] !== 'content' && path[0] !== 'assets');
      });
      if (snapshot.state.chats?.length === 0 && Object.keys(remote).some((key) => JSON.parse(key)[0] === 'chats' && JSON.parse(key).length > 1)) {
        throw new Error('Cloud sync skipped because the snapshot would erase all chats.');
      }
      const merged = await applyChanges(remote, changes);
      try { await fromRecords(merged); }
      catch (error) {
        // Two valid edits can conflict structurally (for example, deleting a branch another device extends).
        await fromRecords(local); await fromRecords(remote);
        throw new SyncConflictError(changes.map(change => change.key));
      }
      if (changes.length) {
        await this.prepare(changes, localHashes);
        await this.sendPending();
        await this.refresh();
        await this.remote(); // Detect concurrent conflicting publications; never report them as synced.
      } else {
        this.cache.baseline = localHashes;
        await this.save();
      }
    });
  }

  async resolve(snapshot: Snapshot, mode: Resolution): Promise<Snapshot> {
    const local = await toRecords(snapshot);
    return this.run(async () => {
      await this.sendPending();
      await this.refresh();
      const remote = await this.remote(true);
      const resolutions = this.remoteConflicts;
      let cloud = remote;
      if (Object.keys(resolutions).length) {
        // Each head is a complete view. Merge coherent views rather than picking unrelated node fields.
        const heads = this.heads();
        const ancestors = (id: string, found = new Set<string>()): Set<string> => {
          if (!found.has(id)) { found.add(id); this.cache.commits[id].parents.forEach(p => ancestors(p, found)); }
          return found;
        };
        const sets = heads.map(id => ancestors(id));
        const common = [...sets[0]].filter(id => sets.every(set => set.has(id)));
        const base = common.length ? await hashRecords(await this.remote(false, common)) : {};
        cloud = await this.remote(false, [heads[0]]);
        for (const head of heads.slice(1)) cloud = await mergeSyncRecords(base, cloud, await this.remote(false, [head]));
      }
      const chosen = mode === 'local' ? local : mode === 'cloud' ? cloud
        : await mergeSyncRecords(this.cache.baseline ?? {}, local, cloud);
      const result = await fromRecords(chosen);
      const changes = await diffRecords(remote, chosen);
      for (const key of Object.keys(resolutions)) if (!changes.some(change => change.key === key)) {
        changes.push({ key, before: remote[key] === undefined ? null : await digest(remote[key]), after: chosen[key] ?? null });
      }
      if (changes.length) {
        await this.prepare(changes, await hashRecords(local), Object.keys(resolutions).length ? resolutions : undefined);
        await this.sendPending();
        await this.refresh();
        await this.remote();
      }
      return result;
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
    syncPhase('saving');
    const baseline = await hashRecords(await toRecords(snapshot));
    await this.run(async () => { this.cache.baseline = baseline; await this.save(); });
  }
}
