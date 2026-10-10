import { isBrowserLocalRecord, isNonBlockingRecord, selectActivePath } from '../google/settings';
import { summarizeSyncSnapshot } from '../google/overview';
import { reportSyncHistory, reportCompaction, recordPackAccess, useGoogleSyncDiagnostics } from '../google/diagnostics';
import { SyncConflictError, type Resolution } from '../google/conflicts';
import { mergeSyncRecords } from '../google/merge';
import { replayHistoryAsync, decodePartsAsync, encodeAsync, decodeAsync, toRecordsAsync as toRecords, fromRecordsAsync as fromRecords, hashRecordsAsync as hashRecords, hashCommitsAsync } from '../google/processing';
import { syncPhase, completedFile, syncStage } from '../google/progress';
import { createKeyEnvelope, unlockKey, encode, decode, encrypt, decrypt, digest, type KeyEnvelope } from '../google/crypto';
import { diffHashedRecords, applyChanges, type Records, type Snapshot, type Change, diffRecords } from '../google/records';
import { SyncFileNotFoundError, type SyncDataset, type SyncTransport } from './transport';
import { syncCache, readSyncEntries, writeSyncCache, rememberedSyncKey } from '../google/cache';

import type { Commit } from '../google/replay';
interface CommitManifest { version: number; parts?: string[]; parents?: string[]; changes?: Change[]; resolutions?: Commit['resolutions'] }
interface Pending {
  id: string;
  commit: Commit;
  baseline?: Records;
  files: { id: string; kind: string; size: number; bytes?: Uint8Array; sent: boolean }[];
}
interface PackManifest { version: 1; commits: Record<string, string>; parts: string[]; bytes: number }
interface Compaction {
  id: string;
  manifest: PackManifest;
  files: Pending['files'];
  remove: string[];
}
interface Cache {
  version: 1;
  commits: Record<string, Commit>;
  token?: string;
  baseline?: Records;
  pending?: Pending;
  packs?: Record<string, PackManifest>;
  parts?: Record<string, string[]>;
  compaction?: Compaction;
}
const emptyCache = (): Cache => ({ version: 1, commits: {} });
const PART_BYTES = 1024 * 1024;
const INLINE_BYTES = 256 * 1024;
const PACK_BYTES = 4 * 1024 * 1024 - 28; // Includes the AES-GCM overhead within a 4 MiB encrypted file.
const COMPACT_COMMITS = 128;
export interface SyncTransferOptions { partBytes?: number; concurrency?: 1 | 2 }
interface StoredCache {
  version: 2;
  commits: string[];
  token?: string;
  baseline?: Records;
  pending?: { id: string; baseline?: Records; files: { id: string; kind: string; size: number }[] };
  packs?: Cache['packs'];
  parts?: Cache['parts'];
  compaction?: Omit<Compaction, 'files'> & { files: { id: string; kind: string; size: number }[] };
}

export class EncryptedSync {
  private cache: Cache = emptyCache();
  private key?: CryptoKey;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private cacheFingerprint?: string;
  private remoteConflicts: Record<string, (string | null)[]> = {};
  private remoteCache?: { records: Records; conflicts: Record<string, (string | null)[]> };
  private loading = new Set<string>();
  private persistedCommits = new Set<string>();
  private encodedCommits = new Map<string, Uint8Array>();
  constructor(readonly dataset: string, private transport: SyncTransport, private options: SyncTransferOptions = {}) {}

  private context(id: string) { return `${this.dataset}:${id}`; }
  private requireKey(): CryptoKey {
    if (!this.key || this.closed) throw new Error('Unlock encrypted sync with your passphrase first.');
    return this.key;
  }
  close() { this.closed = true; this.key = undefined; this.remoteCache = undefined; }
  private async parallel<T, R>(values: T[], work: (value: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(values.length);
    let next = 0;
    let failure: unknown;
    let failed = false;
    const worker = async () => {
      while (!failed) {
        const index = next++;
        if (index >= values.length) return;
        try { results[index] = await work(values[index]); }
        catch (error) { failed = true; failure = error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.options.concurrency ?? 2, values.length) }, worker));
    if (failed) throw failure;
    return results;
  }
  private async save(remove: string[] = []) {
    const entries: [string, Uint8Array][] = [];
    const commits = { ...this.cache.commits };
    const pending = this.cache.pending;
    if (pending) commits[pending.id] = pending.commit;
    for (const [id, commit] of Object.entries(commits)) {
      if (this.persistedCommits.has(id)) continue;
      entries.push([`commit:${id}`, await encrypt(this.requireKey(), this.encodedCommits.get(id) ?? await encodeAsync(commit), this.context(`commit:${id}`))]);
    }
    const uploads = [pending, this.cache.compaction].filter((p): p is Pending | Compaction => !!p);
    for (const upload of uploads) for (const file of upload.files) {
      if (file.bytes) entries.push([`outbox:${file.id}`, file.bytes]);
      if (file.sent) entries.push([`ack:${file.id}`, await encrypt(this.requireKey(), encode(upload.id), this.context(`ack:${file.id}`))]);
    }
    const stored: StoredCache = {
      version: 2, commits: Object.keys(this.cache.commits), token: this.cache.token, baseline: this.cache.baseline,
      pending: pending && { id: pending.id, baseline: pending.baseline,
        files: pending.files.map(({ id, kind, size }) => ({ id, kind, size })) },
      packs: this.cache.packs, parts: this.cache.parts,
      compaction: this.cache.compaction && { ...this.cache.compaction,
        files: this.cache.compaction.files.map(({ id, kind, size }) => ({ id, kind, size })) },
    };
    const bytes = await encrypt(this.requireKey(), await encodeAsync(stored), this.context('cache'));
    // Publishing the outbox and its immutable ciphertext is one durable transaction.
    await writeSyncCache(this.dataset, bytes, entries, remove);
    for (const id of Object.keys(commits)) { this.persistedCommits.add(id); this.encodedCommits.delete(id); }
    for (const upload of uploads) for (const file of upload.files) delete file.bytes;
    this.cacheFingerprint = await digest(bytes);
    const packs = Object.values(this.cache.packs ?? {});
    const covered = new Set(packs.flatMap(pack => Object.keys(pack.commits)));
    reportSyncHistory({ unaggregated: Object.keys(this.cache.commits).filter(id => !covered.has(id)).length,
      threshold: COMPACT_COMMITS, partBytes: PACK_BYTES, packs: packs.map(pack => ({ bytes: pack.bytes, parts: pack.parts.length })),
      cleanupTargets: this.cache.compaction?.remove.length ?? 0 });
  }
  private async loadCache(bytes: Uint8Array) {
    this.remoteCache = undefined;
    const stored = await decodeAsync<StoredCache | Cache>(await decrypt(this.requireKey(), bytes, this.context('cache')));
    if (stored.version === 1) {
      // Upgrade legacy outboxes without regenerating a single ID or ciphertext byte.
      this.cache = stored;
      if (stored.baseline) this.cache.baseline = await hashRecords(stored.baseline);
      if (stored.pending) {
        if (stored.pending.baseline) stored.pending.baseline = await hashRecords(stored.pending.baseline);
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
      commits[ids[i]] = await decodeAsync<Commit>(await decrypt(this.requireKey(), values[i]!, this.context(`commit:${ids[i]}`)));
      this.persistedCommits.add(ids[i]);
    }
    this.cache = { version: 1, commits: Object.fromEntries(stored.commits.map(id => [id, commits[id]])), token: stored.token, baseline: stored.baseline,
      pending: stored.pending && { ...stored.pending, commit: commits[stored.pending.id], files: stored.pending.files.map(f => ({ ...f, sent: false })) },
      packs: stored.packs, parts: stored.parts,
      compaction: stored.compaction && { ...stored.compaction, files: stored.compaction.files.map(f => ({ ...f, sent: false })) } };
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
          this.cache = emptyCache(); this.remoteCache = undefined; this.persistedCommits.clear(); this.encodedCommits.clear();
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

  static async create<T extends SyncDataset>(transport: SyncTransport<T>, password: string, options: SyncTransferOptions & { folderName?: string } = {}): Promise<{ session: EncryptedSync; file: T }> {
    // Derive the key before creating remote files, so invalid passphrases cannot create empty folders.
    const [dataset, header] = await transport.ids(2);
    syncPhase('key');
    const { key, envelope } = await createKeyEnvelope(password, dataset);
    const session = new EncryptedSync(dataset, transport, options);
    session.key = key;
    await session.save();
    await rememberedSyncKey(dataset, key);
    const headerBytes = new TextEncoder().encode(JSON.stringify(envelope));
    await writeSyncCache(dataset, undefined, [['initial-key', await encrypt(key, headerBytes, session.context('initial-key'))]]);
    syncPhase('folder');
    const file = await transport.folder(dataset, header, options.folderName);
    await transport.put(header, dataset, 'key', headerBytes);
    await writeSyncCache(dataset, undefined, [], ['initial-key']);
    return { session, file };
  }
  async resumeCreation(header: string): Promise<void> {
    await this.run(async () => {
      const [saved] = await readSyncEntries(this.dataset, ['initial-key']);
      if (!saved) return;
      const bytes = await decrypt(this.requireKey(), saved, this.context('initial-key'));
      await this.transport.folder(this.dataset, header);
      await this.transport.put(header, this.dataset, 'key', bytes);
      await writeSyncCache(this.dataset, undefined, [], ['initial-key']);
    });
  }
  async unlock(password: string): Promise<void> {
    const header = await this.transport.keyHeader(this.dataset);
    syncPhase('downloading');
    const envelope = JSON.parse(new TextDecoder().decode(await this.transport.read(header))) as KeyEnvelope;
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

  private async downloadManifest(id: string): Promise<CommitManifest> {
    const encoded = await decrypt(this.requireKey(), await this.transport.read(id), this.context(id));
    const manifest = await decodeAsync<CommitManifest>(encoded);
    if (manifest.version !== 2 && (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length ||
        manifest.parts.some(p => typeof p !== 'string'))) throw new Error('Invalid sync commit.');
    return manifest;
  }

  private async loadCommit(id: string, manifests: Map<string, CommitManifest>): Promise<void> {
    if (this.cache.commits[id]) return;
    if (this.loading.has(id)) throw new Error('Cyclic sync history.');
    this.loading.add(id);
    try {
    const packed = Object.entries(this.cache.packs ?? {}).find(([, pack]) => Object.hasOwn(pack.commits, id));
    if (packed) { await this.loadPack(packed[1]); return; }
    const manifest = manifests.get(id) ?? await this.downloadManifest(id);
    if (!manifests.has(id)) syncPhase('downloading'); // A parent absent from the listing makes the total unknown.
    let payload: Uint8Array;
    let commit: Commit;
    if (manifest.version === 2) {
      commit = { version: 1, parents: manifest.parents!, changes: manifest.changes!, ...(manifest.resolutions ? { resolutions: manifest.resolutions } : {}) };
      payload = await encodeAsync(commit);
    } else {
      const chunks = await this.parallel(manifest.parts!, async (part) => {
        const bytes = await decrypt(this.requireKey(), await this.transport.read(part), this.context(part));
        completedFile(bytes.length);
        return bytes;
      });
      const decoded = await decodePartsAsync<Commit>(chunks);
      payload = decoded.bytes;
      commit = decoded.value;
    }
    if (commit.version !== 1 || !Array.isArray(commit.parents) || !Array.isArray(commit.changes) ||
        commit.parents.some(p => typeof p !== 'string' || p === id)) throw new Error('Invalid sync commit.');
    this.encodedCommits.set(id, payload);
    (this.cache.parts ??= {})[id] = manifest.parts ?? [];
    // Load parents even if the change listing has not exposed them yet.
    for (const parent of commit.parents) await this.loadCommit(parent, manifests);
    this.cache.commits[id] = commit;
    } finally { this.loading.delete(id); }
  }

  private async readPackManifest(id: string): Promise<PackManifest> {
    const pack = await decodeAsync<PackManifest>(await decrypt(this.requireKey(), await this.transport.read(id, 'pack-index'), this.context(id)));
    if (pack.version !== 1 || !pack.commits || typeof pack.commits !== 'object' || Array.isArray(pack.commits) ||
        !Object.keys(pack.commits).length || Object.entries(pack.commits).some(([id, hash]) =>
          !/^[A-Za-z0-9_-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) ||
          typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) ||
        !Array.isArray(pack.parts) || !pack.parts.length || pack.parts.some(part => typeof part !== 'string' || !part) ||
        new Set(pack.parts).size !== pack.parts.length || !Number.isSafeInteger(pack.bytes) || pack.bytes < 1) {
      throw new Error('Invalid sync pack.');
    }
    return pack;
  }
  private async loadPack(pack: PackManifest, verify = false): Promise<void> {
    const missing = Object.keys(pack.commits).some(commit => !this.cache.commits[commit]);
    // Authenticate the index against retained commits without downloading known payloads again.
    const retained = Object.fromEntries(Object.keys(pack.commits)
      .filter(commit => this.cache.commits[commit]).map(commit => [commit, this.cache.commits[commit]]));
    for (const [commit, hash] of Object.entries(await hashCommitsAsync(retained))) {
      if (hash !== pack.commits[commit]) throw new Error('Sync pack history mismatch.');
    }
    if (!missing && !verify) { recordPackAccess(true); return; }
    syncPhase('downloading', pack.parts.length);
    const chunks = await this.parallel(pack.parts, async (part) => {
      const bytes = await decrypt(this.requireKey(), await this.transport.read(part, verify ? 'verification' : 'pack'), this.context(part));
      completedFile(bytes.length);
      return bytes;
    });
    const size = chunks.reduce((total, bytes) => total + bytes.length, 0);
    if (size !== pack.bytes) throw new Error('Incomplete sync pack.');
    const { value: data } = await decodePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks);
    if (data.version !== 1 || !data.commits || Object.keys(data.commits).length !== Object.keys(pack.commits).length) {
      throw new Error('Invalid sync pack.');
    }
    const encoded = new Map<string, Uint8Array>();
    for (const [commit] of Object.entries(pack.commits)) {
      const value = data.commits[commit];
      if (!Object.hasOwn(data.commits, commit) || !value || value.version !== 1 || !Array.isArray(value.parents) ||
          value.parents.some(parent => typeof parent !== 'string' || parent === commit) || !Array.isArray(value.changes)) {
        throw new Error('Invalid packed commit.');
      }
      encoded.set(commit, await encodeAsync(value));
    }
    for (const [commit, hash] of Object.entries(pack.commits)) if (await digest(encoded.get(commit)!) !== hash) {
      throw new Error('Sync pack history mismatch.');
    }
    if (!verify) recordPackAccess(false);
    // Never cache half a pack after failed authentication.
    if (encoded.size) this.remoteCache = undefined;
    for (const [commit, bytes] of encoded) {
      this.cache.commits[commit] = data.commits[commit];
      if (!this.persistedCommits.has(commit)) this.encodedCommits.set(commit, bytes);
    }
  }
  private async discoverPacks(ids?: string[]): Promise<void> {
    ids ??= await this.transport.packs(this.dataset);
    const packs = this.cache.packs ??= {};
    for (const id of Object.keys(packs)) if (!ids.includes(id)) delete packs[id];
    for (const id of ids) {
      const pack = packs[id] ?? await this.readPackManifest(id);
      await this.loadPack(pack);
      packs[id] = pack;
    }
  }
  private packedCommits(): Set<string> {
    return new Set(Object.values(this.cache.packs ?? {}).flatMap(pack => Object.keys(pack.commits)));
  }
  private async refresh(retry = true): Promise<void> {
    try {
      syncPhase('checking');
      const ids = new Set<string>();
      if (!this.cache.token) {
        const token = await this.transport.startToken();
        const history = await this.transport.history(this.dataset);
        await this.discoverPacks(history.packs);
        for (const id of history.commits) ids.add(id);
        this.cache.token = token;
      }
      const page = await this.transport.changes(this.cache.token!);
      if (page.changes.some(change => change.removed || (change.dataset === this.dataset &&
          (change.kind === 'commit' || change.kind === 'pack')))) this.remoteCache = undefined;
      const removed = new Set(page.changes.filter(change => change.removed).map(change => change.id));
      if (removed.has(this.dataset)) throw new Error('Sync folder was deleted from storage; sync stopped.');
      const oldPacks = this.cache.packs ?? {};
      const removedPacks = Object.entries(oldPacks).filter(([id]) => removed.has(id));
      const packChanged = page.changes.some(change => change.dataset === this.dataset &&
        change.kind === 'pack') || removedPacks.length > 0;
      // Query live indexes rather than reading stale creation events followed by deletion events.
      if (packChanged || [...removed].some(id => this.cache.commits[id] || ids.has(id))) await this.discoverPacks();
      const covered = this.packedCommits();
      for (const [, pack] of removedPacks) if (Object.keys(pack.commits).some(id => !covered.has(id))) {
        throw new Error('Sync history was deleted from storage; sync stopped.');
      }
      for (const id of removed) {
        if ((this.cache.commits[id] || ids.has(id)) && !covered.has(id)) {
          throw new Error('Sync history was deleted from storage; sync stopped.');
        }
        ids.delete(id);
      }
      for (const change of page.changes) {
        if (change.dataset === this.dataset && change.kind === 'commit' &&
            !removed.has(change.id)) ids.add(change.id);
      }
      const missing = [...ids].filter(id => !this.cache.commits[id]);
      if (missing.length) {
        syncPhase('downloading');
        const manifests = new Map<string, CommitManifest>();
        let partCount = 0;
        const unbundled = missing.filter(id => !covered.has(id));
        const downloaded = await this.parallel(unbundled, async (id) => [id, await this.downloadManifest(id)] as const);
        for (const [id, manifest] of downloaded) {
          manifests.set(id, manifest);
          if (manifest.version === 1) partCount += manifest.parts!.length;
        }
        syncPhase('downloading', missing.length + partCount, undefined, missing.length);
        for (const id of missing) await this.loadCommit(id, manifests);
      }
      for (const commit of Object.values(this.cache.commits)) for (const parent of commit.parents) {
        if (!this.cache.commits[parent]) await this.loadCommit(parent, new Map());
      }
      this.cache.token = page.token;
      // Cursor and downloaded commits are committed together. Failed reads never advance the durable cursor.
      await this.save();
    } catch (error) {
      // A reader may race source deletion after listing or while fetching an old multipart commit.
      if (!retry || !(error instanceof SyncFileNotFoundError)) throw error;
      // Re-list after a failed initial read; its provisional cursor has not accepted the history yet.
      this.cache.token = undefined;
      await this.discoverPacks();
      await this.refresh(false);
    }
  }
  private heads(): string[] {
    const parents = new Set(Object.values(this.cache.commits).flatMap((c) => c.parents));
    return Object.keys(this.cache.commits).filter((id) => !parents.has(id)).sort();
  }
  private async remote(allowConflicts = false, tips?: string[]): Promise<Records> {
    syncPhase('verifying');
    const cached = tips ? undefined : this.remoteCache;
    const { records, conflicts } = cached ?? await replayHistoryAsync({ commits: this.cache.commits, tips: tips ?? this.heads() });
    if (!tips) this.remoteCache = { records, conflicts };
    this.remoteConflicts = conflicts;
    if (!allowConflicts && Object.keys(conflicts).length) throw new SyncConflictError(Object.keys(conflicts));
    return records;
  }
  private async sendFiles(pending: Pick<Pending, 'id' | 'files'>, publication: string) {
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
      await this.transport.put(file.id, this.dataset, file.kind, bytes);
      // Only the tiny authenticated acknowledgement changes after each upload.
      const ack = await encrypt(this.requireKey(), encode(pending.id), this.context(`ack:${file.id}`));
      await writeSyncCache(this.dataset, undefined, [[`ack:${file.id}`, ack]]);
      file.sent = true;
      completedFile(file.size);
    };
    const parts = remaining.filter(file => file.kind !== publication);
    await this.parallel(parts, send);
    // The commit is the publication boundary: never publish incomplete data.
    for (const file of remaining.filter(file => file.kind === publication)) await send(file);
  }
  private async sendPending() {
    const pending = this.cache.pending;
    if (!pending) return;
    await this.sendFiles(pending, 'commit');
    syncPhase('saving');
    (this.cache.parts ??= {})[pending.id] = pending.files.filter(file => file.kind === 'part').map(file => file.id);
    this.cache.commits[pending.id] = pending.commit;
    this.remoteCache = undefined;
    if (pending.baseline) this.cache.baseline = pending.baseline;
    delete this.cache.pending;
    await this.save(pending.files.flatMap(f => [`outbox:${f.id}`, `ack:${f.id}`]));
  }
  private async finishCompaction() {
    const pending = this.cache.compaction;
    if (!pending) return;
    if (useGoogleSyncDiagnostics.getState().compaction.status !== 'running') {
      reportCompaction({ status: 'running', reason: 'resume', sourceFiles: pending.remove.length, newFiles: pending.files.length });
    }
    await this.sendFiles(pending, 'pack');
    try {
      const manifest = await this.readPackManifest(pending.id);
      if (await digest(await encodeAsync(manifest)) !== await digest(await encodeAsync(pending.manifest))) {
        throw new Error('Sync pack publication mismatch.');
      }
      // Read back every byte before the first irreversible deletion, including on a resumed run.
      await this.loadPack(manifest, true);
      (this.cache.packs ??= {})[pending.id] = manifest;
    } catch (error) {
      if (!(error instanceof SyncFileNotFoundError)) throw error;
      // Another device can consolidate this published pack before its owner finishes cleanup.
      await this.discoverPacks();
      const replacements = Object.values(this.cache.packs ?? {}).filter(pack =>
        Object.keys(pack.commits).some(id => Object.hasOwn(pending.manifest.commits, id)));
      for (const [id, hash] of Object.entries(pending.manifest.commits)) if (!replacements.some(pack => pack.commits[id] === hash)) {
        throw new Error('Missing compacted sync history.');
      }
      for (const pack of replacements) await this.loadPack(pack, true);
    }
    await this.refresh();
    await this.remote();
    syncPhase('saving');
    await this.parallel(pending.remove, id => this.transport.remove(id));
    for (const id of pending.remove) {
      delete this.cache.packs?.[id];
      delete this.cache.parts?.[id];
    }
    delete this.cache.compaction;
    await this.save(pending.files.flatMap(file => [`outbox:${file.id}`, `ack:${file.id}`]));
    reportCompaction({ status: 'completed', sourceFiles: pending.remove.length, newFiles: pending.files.length });
  }
  private async compact(force = false) {
    if (this.transport.supportsCompaction === false) return;
    await this.finishCompaction();
    const covered = this.packedCommits();
    if (Object.keys(this.cache.commits).filter(id => !covered.has(id)).length < (force ? 1 : COMPACT_COMMITS)) {
      reportCompaction({ status: 'skipped', reason: 'belowThreshold' }); return;
    }
    // Capture live sources once. Commits published by another device later are never deletion targets.
    await this.discoverPacks();
    const raw = await this.transport.commits(this.dataset);
    if (raw.length < (force ? 1 : COMPACT_COMMITS)) { reportCompaction({ status: 'skipped', reason: 'liveBelowThreshold' }); return; }
    const groups: { commits: string[]; sources: string[]; size: number }[] = [];
    let group = { commits: [] as string[], sources: [] as string[], size: 0 };
    for (const id of raw.sort()) {
      const commit = this.cache.commits[id];
      if (!commit) continue; // A concurrent publication belongs to the next synchronization.
      const size = Math.max((await encodeAsync(commit)).length, id.length + 128);
      if (group.commits.length && group.size + size > PACK_BYTES) {
        groups.push(group); group = { commits: [], sources: [], size: 0 };
      }
      const parts = this.cache.parts?.[id] ?? (await this.downloadManifest(id)).parts ?? [];
      group.commits.push(id); group.sources.push(id, ...parts); group.size += size;
    }
    if (group.commits.length) groups.push(group);
    // Fold small existing packs into the new group; do not rewrite full packs on every edit.
    for (const [id, pack] of Object.entries(this.cache.packs ?? {})) {
      const size = Math.max(pack.bytes, Object.keys(pack.commits).reduce((sum, commit) => sum + commit.length + 128, 0));
      const target = groups.find(group => group.size + size <= PACK_BYTES);
      if (!target) continue;
      target.commits.push(...Object.keys(pack.commits)); target.sources.push(id, ...pack.parts); target.size += size;
    }
    for (const group of groups) {
      const commits = Object.fromEntries([...new Set(group.commits)].sort().map(id => [id, this.cache.commits[id]]));
      const payload = await encodeAsync({ version: 1, commits });
      const hashes = await hashCommitsAsync(commits);
      const [id, ...parts] = await this.transport.ids(1 + Math.ceil(payload.length / PACK_BYTES));
      const files: Pending['files'] = [];
      for (let i = 0; i < parts.length; i++) {
        const bytes = await encrypt(this.requireKey(), payload.slice(i * PACK_BYTES, (i + 1) * PACK_BYTES), this.context(parts[i]));
        files.push({ id: parts[i], kind: 'pack-part', bytes, size: bytes.length, sent: false });
      }
      const manifest: PackManifest = { version: 1, commits: hashes, parts, bytes: payload.length };
      const bytes = await encrypt(this.requireKey(), await encodeAsync(manifest), this.context(id));
      if (bytes.length > PACK_BYTES + 28) throw new Error('Sync pack index too large.');
      files.push({ id, kind: 'pack', bytes, size: bytes.length, sent: false });
      this.cache.compaction = { id, manifest, files, remove: [...new Set(group.sources)] };
      await this.save();
      reportCompaction({ status: 'running', reason: 'new', sourceFiles: this.cache.compaction.remove.length, newFiles: files.length });
      await this.finishCompaction();
    }
  }
  private async prepare(changes: Change[], baseline: Records | undefined, resolutions?: Commit['resolutions']) {
    syncPhase('encrypting');
    const commit: Commit = { version: 1, parents: this.heads(), changes, ...(resolutions ? { resolutions } : {}) };
    const payload = await encodeAsync(commit);
    const inline = commit.parents.length > 0 && payload.length <= INLINE_BYTES;
    const partBytes = this.options.partBytes ?? PART_BYTES;
    const [id, ...parts] = await this.transport.ids(inline ? 1 : 1 + Math.ceil(payload.length / partBytes));
    syncPhase('encrypting', parts.length + 1);
    const files: Pending['files'] = [];
    for (let i = 0; i < parts.length; i++) {
      const bytes = await encrypt(this.requireKey(), payload.slice(i * partBytes, (i + 1) * partBytes), this.context(parts[i]));
      files.push({ id: parts[i], kind: 'part', bytes, size: bytes.length, sent: false });
      completedFile(bytes.length);
    }
    const bytes = await encrypt(this.requireKey(), await encodeAsync(inline ? { ...commit, version: 2 } : { version: 1, parts }), this.context(id));
    files.push({ id, kind: 'commit', bytes, size: bytes.length, sent: false });
    completedFile(bytes.length);
    this.encodedCommits.set(id, payload);
    this.cache.pending = { id, commit, baseline, files };
    await this.save();
  }

  // Import to remote only: preserve the current local baseline and remote records.
  async importSnapshot(snapshot: Snapshot): Promise<void> {
    const local = await syncStage(0, 6, () => toRecords(snapshot));
    await this.run(async () => {
      await syncStage(1, 6, async () => { await this.sendPending(); await this.finishCompaction(); });
      await syncStage(2, 6, () => this.refresh());
      const remote = await syncStage(3, 6, () => this.remote());
      await syncStage(4, 6, async () => {
        const merged = await mergeSyncRecords({}, local, remote);
        const changes = await diffRecords(remote, merged);
        if (changes.length) {
          await this.prepare(changes, this.cache.baseline);
          await this.sendPending();
        }
      });
      await syncStage(5, 6, async () => { await this.compact(); await this.refresh(); await this.remote(); });
    });
  }

  async compactHistory(): Promise<void> {
    await this.run(async () => {
      await syncStage(0, 4, async () => { await this.sendPending(); await this.finishCompaction(); });
      await syncStage(1, 4, () => this.refresh());
      await syncStage(2, 4, () => this.remote());
      await syncStage(3, 4, () => this.compact(true));
    });
  }

  async synchronize(snapshot: Snapshot, replace: boolean | 'if-empty' = false): Promise<Snapshot> {
    syncPhase('preparing');
    const local = await syncStage(0, 8, () => toRecords(snapshot));
    return this.run(async () => {
      await syncStage(1, 8, async () => { await this.sendPending(); await this.finishCompaction(); });
      await syncStage(2, 8, () => this.refresh());
      const remote = await syncStage(3, 8, () => this.remote());
      const { localHashes, changes } = await syncStage(4, 8, async () => {
        syncPhase('preparing');
        if (replace === 'if-empty' && !this.cache.baseline && Object.keys(remote).length) throw new Error('Existing history must be downloaded before initializing sync.');
        if (!replace && !this.cache.baseline) throw new Error('Choose upload or download before enabling automatic sync.');
        const base = replace === true || (replace === 'if-empty' && !this.cache.baseline) ? await hashRecords(remote) : this.cache.baseline!;
        const localHashes = await hashRecords(local);
        const changes = await Promise.all(diffHashedRecords(base, local, localHashes).filter((change) => {
          if (isBrowserLocalRecord(change.key)) return false;
          // Content and assets are immutable and may be referenced by another device. Never GC them from a local snapshot.
          const path = JSON.parse(change.key);
          return change.after !== null || (path[0] !== 'content' && path[0] !== 'assets');
        }).map(async change => isNonBlockingRecord(change.key)
          ? { ...change, before: remote[change.key] === undefined ? null : await digest(remote[change.key]) }
          : change));
        if (snapshot.state.chats?.length === 0 && Object.keys(remote).some((key) => JSON.parse(key)[0] === 'chats' && JSON.parse(key).length > 1)) {
          throw new Error('Cloud sync skipped because the snapshot would erase all chats.');
        }
        const merged = await applyChanges(remote, changes);
        for (const change of changes) {
          if (change.after === null) continue;
          const selected = selectActivePath(change.key, [change.after, remote[change.key] ?? null], merged);
          if (selected !== undefined) {
            change.after = selected;
            if (selected === null) delete merged[change.key];
            else merged[change.key] = selected;
          }
        }
        try { await fromRecords(merged); }
        catch (error) {
          // Two valid edits can conflict structurally (for example, deleting a branch another device extends).
          await fromRecords(local); await fromRecords(remote);
          throw new SyncConflictError(changes.map(change => change.key));
        }
        return { localHashes, changes };
      });
      await syncStage(5, 8, async () => {
        if (changes.length) {
          await syncStage(0, 2, () => this.prepare(changes, localHashes));
          await syncStage(1, 2, () => this.sendPending());
        } else {
          this.cache.baseline = localHashes;
          await this.save();
        }
      });
      await syncStage(6, 8, () => this.compact());
      const finalRemote = await syncStage(7, 8, async () => {
        await this.refresh();
        return this.remote(); // Detect concurrent conflicting publications and cleanup before reporting success.
      });
      return fromRecords(finalRemote);
    });
  }

  async push(snapshot: Snapshot, replace: boolean | 'if-empty' = false): Promise<void> {
    await this.synchronize(snapshot, replace);
  }

  private async coherentCloudRecords(remote: Records): Promise<Records> {
    let cloud = remote;
    if (Object.keys(this.remoteConflicts).length) {
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
    return cloud;
  }

  async overview() {
    return this.run(async () => {
      // Inspect published history without sending the outbox or accepting a new baseline.
      await this.refresh();
      const remote = await this.remote(true);
      const cloud = await this.coherentCloudRecords(remote);
      const snapshot = await fromRecords(cloud);
      return { ...await summarizeSyncSnapshot(snapshot), versions: this.heads().length };
    });
  }

  async inspect() {
    return this.run(async () => {
      await this.refresh();
      const remote = await this.remote(true);
      const heads = this.heads();
      const snapshot = await fromRecords(await this.coherentCloudRecords(remote));
      const versions = heads.length > 1 ? await Promise.all(heads.map(async id => ({
        id, snapshot: await fromRecords(await this.remote(false, [id])),
      }))) : [];
      return { snapshot, versions };
    });
  }

  async resolve(snapshot: Snapshot, mode: Resolution): Promise<Snapshot> {
    const local = await syncStage(0, 8, () => toRecords(snapshot));
    return this.run(async () => {
      await syncStage(1, 8, async () => { await this.sendPending(); await this.finishCompaction(); });
      await syncStage(2, 8, () => this.refresh());
      const remote = await syncStage(3, 8, () => this.remote(true));
      const { result, changes, resolutions } = await syncStage(4, 8, async () => {
        const resolutions = this.remoteConflicts;
        const cloud = await this.coherentCloudRecords(remote);
        const chosen = mode === 'local' ? local : mode === 'cloud' ? cloud
          : await mergeSyncRecords(this.cache.baseline ?? {}, local, cloud);
        const result = await fromRecords(chosen);
        const changes = await diffRecords(remote, chosen);
        for (const key of Object.keys(resolutions)) if (!changes.some(change => change.key === key)) {
          changes.push({ key, before: remote[key] === undefined ? null : await digest(remote[key]), after: chosen[key] ?? null });
        }
        return { result, changes, resolutions };
      });
      await syncStage(5, 8, async () => {
        if (changes.length) {
          await syncStage(0, 2, async () => this.prepare(changes, await hashRecords(local), Object.keys(resolutions).length ? resolutions : undefined));
          await syncStage(1, 2, () => this.sendPending());
        }
      });
      await syncStage(6, 8, async () => {
        if (changes.length) {
          await this.refresh();
          await this.remote(); // Detect concurrent conflicting publications before reporting success.
        }
      });
      await syncStage(7, 8, () => this.compact());
      return result;
    });
  }

  async pull(publishPending = true): Promise<Snapshot> {
    return this.run(async () => {
      await syncStage(0, 4, async () => { if (publishPending) { await this.sendPending(); await this.finishCompaction(); } });
      await syncStage(1, 4, () => this.refresh());
      const records = await syncStage(2, 4, () => this.remote());
      if (!Object.keys(records).length) throw new Error('This encrypted folder has no completed upload yet.');
      return syncStage(3, 4, () => fromRecords(records));
    });
  }
  // Call only after the existing local persistence has accepted the downloaded state.
  async acceptLocal(snapshot: Snapshot, discardPending = false): Promise<void> {
    syncPhase('saving');
    const baseline = await hashRecords(await toRecords(snapshot));
    await this.run(async () => {
      const remove = discardPending ? this.cache.pending?.files.flatMap(file => [`outbox:${file.id}`, `ack:${file.id}`]) ?? [] : [];
      if (discardPending) delete this.cache.pending;
      this.cache.baseline = baseline;
      await this.save(remove);
    });
  }
}
