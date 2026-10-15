import { isBrowserLocalRecord, isNonBlockingRecord, selectActivePath } from '../google/settings';
import { summarizeSyncSnapshot } from '../google/overview';
import { reportSyncHistory, reportCompaction, recordPackAccess, useGoogleSyncDiagnostics } from '../google/diagnostics';
import { SyncConflictError, type Resolution } from '../google/conflicts';
import { mergeSyncRecords } from '../google/merge';
import { mergeEditTimes } from '../google/editTimes';
import { collectHistoryAsync, replayHistoryAsync, decodePartsAsync, encodeWireAsync, decodeWirePartsAsync, encodeAsync, decodeAsync, encodeCacheAsync, decodeCacheAsync, toRecordsAsync as toRecords, fromRecordsAsync as fromRecords, hashRecordsAsync as hashRecords, hashCommitsAsync, encodeNativeAsync, decodeNativePartsAsync, hashNativeCommitsAsync } from '../google/processing';
import { syncPhase, completedFile, syncStage } from '../google/progress';
import { createKeyEnvelope, unlockKey, encode, decode, encrypt, decrypt, digest, type KeyEnvelope } from '../google/crypto';
import { diffHashedRecords, applyChanges, sameRecords, type Records, type Snapshot, type Change, diffRecords } from '../google/records';
import { SyncFileNotFoundError, type SyncDataset, type SyncTransport } from './transport';
import { syncCache, readSyncEntries, writeSyncCache, rememberedSyncKey } from '../google/cache';

import type { Commit } from '../google/replay';
import { requireNativeGzip } from '../google/gzip';
import { frameCacheGzip } from '../google/cacheCodec';
import { createEncodedCheckpointAsync, decodeVerifyCheckpointAsync } from '../google/processing';
interface CommitManifest { version: number; parts?: string[]; parents?: string[]; changes?: Change[]; resolutions?: Commit['resolutions'] }
interface Pending {
  id: string;
  commit: Commit;
  baseline?: Records;
  files: { id: string; kind: string; size: number; bytes?: Uint8Array; sent: boolean }[];
}
interface PackManifest { version: 1 | 2 | 3; commits: Record<string, string>; parts: string[]; bytes: number }
interface Compaction {
  id: string;
  manifest: PackManifest;
  files: Pending['files'];
  remove: string[];
}
interface CheckpointManifest { version: 1; parts: string[]; bytes: number; stateRoot: string }
interface CheckpointUpload { id: string; manifest: CheckpointManifest; commits: string[]; files: Pending['files'] }
interface ReplayCache {
  version: 1;
  commits: string[];
  tips: string[];
  records: Records;
  conflicts: Record<string, (string | null)[]>;
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
  checkpointUpload?: CheckpointUpload;
  lastCheckpoint?: { id: string; commits: string[] };
  seenCheckpoints?: string[];
}
const emptyCache = (): Cache => ({ version: 1, commits: {} });
const PART_BYTES = 1024 * 1024;
const INLINE_BYTES = 256 * 1024;
// Bound JavaScript LZ work before encoding; large payloads go directly to native gzip.
const INLINE_JSON_BOUND = 64 * 1024;
const PACK_BYTES = 4 * 1024 * 1024 - 28; // Includes the AES-GCM overhead within a 4 MiB encrypted file.
const COMPACT_COMMITS = 128;
// Conservative JSON byte bound for grouping and bounded inline selection; the native encoder checks its actual limit.
function nativeCommitByteBound(commit: Commit): number {
  return 128 + commit.parents.reduce((size, parent) => size + parent.length * 6 + 4, 0) +
    commit.changes.reduce((size, change) => size + 128 +
      (change.key.length + (change.before?.length ?? 0) + (change.after?.length ?? 0)) * 6, 0) +
    Object.entries(commit.resolutions ?? {}).reduce((size, [key, values]) => size + 16 + key.length * 6 +
      values.reduce((total, value) => total + (value?.length ?? 0) * 6 + 8, 0), 0);
}
export interface SyncTransferOptions {
  partBytes?: number; concurrency?: 1 | 2;
  // Optional delta payloads for explicit legacy compression; native gzip takes precedence.
  wireDelta?: boolean;
  // Native gzip is the default; explicit legacy preserves the old compression and hash formats.
  wireCompression?: 'gzip' | 'legacy';
}
interface StoredCache {
  version: 2;
  replay?: true;
  replayFingerprint?: string;
  historyParents?: Record<string, string[]>;
  wireDelta?: boolean;
  wireCompression?: 'gzip' | 'legacy';
  commits: string[];
  token?: string;
  baseline?: Records;
  pending?: { id: string; baseline?: Records; files: { id: string; kind: string; size: number }[] };
  packs?: Cache['packs'];
  parts?: Cache['parts'];
  compaction?: Omit<Compaction, 'files'> & { files: { id: string; kind: string; size: number }[] };
  checkpointUpload?: Omit<CheckpointUpload, 'files'> & { files: { id: string; kind: string; size: number }[] };
  lastCheckpoint?: Cache['lastCheckpoint'];
  seenCheckpoints?: string[];
}

export class EncryptedSync {
  private cache: Cache = emptyCache();
  private key?: CryptoKey;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private cacheFingerprint?: string;
  private remoteConflicts: Record<string, (string | null)[]> = {};
  private remoteCache?: ReplayCache;
  private persistedReplay?: ReplayCache;
  private replayFingerprint?: string;
  // Authenticated parent metadata is enough for heads/discovery. Bodies stay on disk until a replay needs them.
  private coldHistory = new Map<string, string[]>();
  private replaySavedAt = 0;
  private loading = new Set<string>();
  private persistedCommits = new Set<string>();
  private encodedCommits = new Map<string, Uint8Array>();
  constructor(readonly dataset: string, private transport: SyncTransport, private options: SyncTransferOptions = {}) {}

  private context(id: string) { return `${this.dataset}:${id}`; }
  private requireKey(): CryptoKey {
    if (!this.key || this.closed) throw new Error('Unlock encrypted sync with your passphrase first.');
    return this.key;
  }
  close() {
    this.closed = true; this.key = undefined; this.remoteCache = undefined; this.persistedReplay = undefined;
    this.replayFingerprint = undefined; this.cacheFingerprint = undefined; this.cache = emptyCache();
    this.coldHistory.clear(); this.persistedCommits.clear(); this.encodedCommits.clear();
  }
  private hasCommit(id: string) { return Object.hasOwn(this.cache.commits, id) || this.coldHistory.has(id); }
  private commitIds() { return [...new Set([...this.coldHistory.keys(), ...Object.keys(this.cache.commits)])]; }
  private parentsOf(id: string) { return this.cache.commits[id]?.parents ?? this.coldHistory.get(id)!; }
  private async hydrateHistory(ids = [...this.coldHistory.keys()]) {
    const missing = ids.filter(id => this.coldHistory.has(id));
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batch = missing.slice(offset, offset + 32);
      const bytes = await readSyncEntries(this.dataset, batch.map(id => `commit:${id}`));
      for (let i = 0; i < batch.length; i++) {
        const id = batch[i];
        if (!this.coldHistory.has(id)) continue; // A recovered pack may have hydrated this whole batch.
        const parents = this.coldHistory.get(id)!;
        try {
          if (!bytes[i]) throw new Error('Missing local sync commit.');
          const commit = await decodeCacheAsync<Commit>(await decrypt(this.requireKey(), bytes[i]!, this.context(`commit:${id}`)));
          if (commit.version !== 1 || !Array.isArray(commit.changes) ||
              JSON.stringify(commit.parents) !== JSON.stringify(parents)) throw new Error('Invalid local sync history.');
          this.cache.commits[id] = commit;
        } catch {
          // The private history cache is replaceable. Keep the baseline/outbox and recover immutable cloud sources.
          const wasPersisted = this.persistedCommits.has(id);
          this.coldHistory.delete(id); this.persistedCommits.delete(id);
          try {
            try { await this.loadCommit(id, new Map()); }
            catch (error) {
              if (!(error instanceof SyncFileNotFoundError)) throw error;
              await this.discoverPacks();
              await this.loadCommit(id, new Map());
            }
            if (JSON.stringify(this.cache.commits[id]?.parents) !== JSON.stringify(parents)) throw new Error('Recovered sync history does not match.');
          }
          catch (error) {
            // A best-effort checkpoint caller may catch this error. Its known history must remain complete.
            delete this.cache.commits[id]; this.encodedCommits.delete(id);
            this.coldHistory.set(id, parents);
            if (wasPersisted) this.persistedCommits.add(id);
            throw error;
          }
        }
        this.coldHistory.delete(id);
      }
    }
  }
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
  private async save(remove: string[] = [], forceReplay = false) {
    const entries: [string, Uint8Array][] = [];
    const commits = { ...this.cache.commits };
    const pending = this.cache.pending;
    if (pending) commits[pending.id] = pending.commit;
    for (const [id, commit] of Object.entries(commits)) {
      if (this.persistedCommits.has(id)) continue;
      entries.push([`commit:${id}`, await encrypt(this.requireKey(), this.encodedCommits.get(id) ?? await encodeCacheAsync(commit), this.context(`commit:${id}`))]);
    }
    const uploads = [pending, this.cache.compaction, this.cache.checkpointUpload].filter((p): p is Pending | Compaction | CheckpointUpload => !!p);
    for (const upload of uploads) for (const file of upload.files) {
      if (file.bytes) entries.push([`outbox:${file.id}`, file.bytes]);
      if (file.sent) entries.push([`ack:${file.id}`, await encrypt(this.requireKey(), encode(upload.id), this.context(`ack:${file.id}`))]);
    }
    let replay = this.persistedReplay;
    let replayFingerprint = this.replayFingerprint;
    if (this.remoteCache && this.remoteCache !== replay) {
      const known = new Set(replay?.commits ?? []);
      const added = this.remoteCache.commits.filter(id => !known.has(id));
      const changedBytes = added.reduce((total, id) => total + this.cache.commits[id].changes.reduce(
        (size, change) => size + change.key.length * 2 + (change.after?.length ?? 0) * 2, 0), 0);
      // Persist complete state periodically, not on each small edit. Commits remain the durable source of truth.
      if (forceReplay || !replay || !replay.commits.length || changedBytes >= 8 * 1024 * 1024 || added.length >= 256 ||
          performance.now() - this.replaySavedAt >= 5 * 60 * 1000) {
        replay = this.remoteCache;
        const bytes = await encrypt(this.requireKey(), await encodeCacheAsync(replay), this.context('replay'));
        replayFingerprint = await digest(bytes);
        entries.push(['replay', bytes]);
      }
    }
    const stored: StoredCache = {
      version: 2, replay: replay ? true : undefined, replayFingerprint,
      historyParents: Object.fromEntries(this.commitIds().map(id => [id, this.parentsOf(id)])),
      wireDelta: this.options.wireDelta, wireCompression: this.options.wireCompression,
      commits: this.commitIds(), token: this.cache.token, baseline: this.cache.baseline,
      pending: pending && { id: pending.id, baseline: pending.baseline,
        files: pending.files.map(({ id, kind, size }) => ({ id, kind, size })) },
      packs: this.cache.packs, parts: this.cache.parts,
      compaction: this.cache.compaction && { ...this.cache.compaction,
        files: this.cache.compaction.files.map(({ id, kind, size }) => ({ id, kind, size })) },
      checkpointUpload: this.cache.checkpointUpload && { ...this.cache.checkpointUpload,
        files: this.cache.checkpointUpload.files.map(({ id, kind, size }) => ({ id, kind, size })) },
      lastCheckpoint: this.cache.lastCheckpoint, seenCheckpoints: this.cache.seenCheckpoints,
    };
    const bytes = await encrypt(this.requireKey(), await encodeCacheAsync(stored), this.context('cache'));
    // Publishing the outbox and its immutable ciphertext is one durable transaction.
    await writeSyncCache(this.dataset, bytes, entries, remove);
    for (const id of Object.keys(commits)) { this.persistedCommits.add(id); this.encodedCommits.delete(id); }
    for (const upload of uploads) for (const file of upload.files) delete file.bytes;
    if (replay !== this.persistedReplay) this.replaySavedAt = performance.now();
    this.persistedReplay = replay;
    this.replayFingerprint = replayFingerprint;
    this.cacheFingerprint = await digest(bytes);
    const packs = Object.values(this.cache.packs ?? {});
    const covered = new Set(packs.flatMap(pack => Object.keys(pack.commits)));
    reportSyncHistory({ unaggregated: this.commitIds().filter(id => !covered.has(id)).length,
      threshold: COMPACT_COMMITS, partBytes: PACK_BYTES, packs: packs.map(pack => ({ bytes: pack.bytes, parts: pack.parts.length })),
      cleanupTargets: this.cache.compaction?.remove.length ?? 0 });
  }
  private async loadCache(bytes: Uint8Array) {
    this.remoteCache = undefined; this.persistedReplay = undefined; this.replayFingerprint = undefined; this.coldHistory.clear();
    const stored = await decodeCacheAsync<StoredCache | Cache>(await decrypt(this.requireKey(), bytes, this.context('cache')));
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
    this.options.wireDelta ??= stored.wireDelta === true;
    this.options.wireCompression ??= stored.wireCompression === 'gzip' || stored.wireCompression === 'legacy' ? stored.wireCompression : undefined;
    const known = new Set(stored.commits);
    if (stored.replay && stored.replayFingerprint && stored.historyParents &&
        stored.commits.length === known.size && Object.keys(stored.historyParents).length === known.size &&
        stored.commits.every(id => typeof id === 'string' && Array.isArray(stored.historyParents![id]) &&
          stored.historyParents![id].every(parent => typeof parent === 'string' && parent !== id && known.has(parent)))) {
      // This is disposable acceleration data: missing/damaged bytes must never block history recovery.
      try {
        const [bytes] = await readSyncEntries(this.dataset, ['replay']);
        if (bytes && await digest(bytes) === stored.replayFingerprint) {
          const replay = await decodeCacheAsync<ReplayCache>(await decrypt(this.requireKey(), bytes, this.context('replay')));
          if (replay.version === 1 && Array.isArray(replay.commits) && Array.isArray(replay.tips) &&
              new Set(replay.commits).size === replay.commits.length &&
              replay.commits.every(id => typeof id === 'string' && known.has(id)) &&
              replay.tips.every(id => typeof id === 'string' && replay.commits.includes(id)) &&
              replay.records && typeof replay.records === 'object' && !Array.isArray(replay.records) &&
              Object.values(replay.records).every(value => typeof value === 'string') &&
              replay.conflicts && typeof replay.conflicts === 'object' && !Array.isArray(replay.conflicts) &&
              Object.values(replay.conflicts).every(values => Array.isArray(values) &&
                values.every(value => value === null || typeof value === 'string'))) {
            this.remoteCache = this.persistedReplay = replay;
            this.replayFingerprint = stored.replayFingerprint;
            // The parent index and fingerprint were committed atomically with this locally verified replay.
            for (const id of replay.commits) this.coldHistory.set(id, stored.historyParents![id]);
            this.replaySavedAt = performance.now();
          }
        }
      } catch { /* Replay from authenticated commits instead. */ }
    }
    const ids = [...new Set([...stored.commits, ...(stored.pending ? [stored.pending.id] : [])])];
    const commits: Record<string, Commit> = {};
    for (let offset = 0; offset < ids.length; offset += 32) {
      const batch = ids.slice(offset, offset + 32).filter(id => !this.coldHistory.has(id) || id === stored.pending?.id);
      if (!batch.length) continue;
      const values = await readSyncEntries(this.dataset, batch.map(id => `commit:${id}`));
      for (let i = 0; i < batch.length; i++) {
        const id = batch[i];
        if (!values[i]) throw new Error('Missing local sync commit.');
        commits[id] = await decodeCacheAsync<Commit>(await decrypt(this.requireKey(), values[i]!, this.context(`commit:${id}`)));
      }
    }
    for (const id of ids) this.persistedCommits.add(id);
    this.cache = { version: 1, commits: Object.fromEntries(stored.commits.filter(id => commits[id]).map(id => [id, commits[id]])),
      token: stored.token, baseline: stored.baseline,
      pending: stored.pending && { ...stored.pending, commit: commits[stored.pending.id], files: stored.pending.files.map(f => ({ ...f, sent: false })) },
      packs: stored.packs, parts: stored.parts,
      compaction: stored.compaction && { ...stored.compaction, files: stored.compaction.files.map(f => ({ ...f, sent: false })) } };
    this.cache.checkpointUpload = stored.checkpointUpload && { ...stored.checkpointUpload,
      files: stored.checkpointUpload.files.map(f => ({ ...f, sent: false })) };
    this.cache.lastCheckpoint = stored.lastCheckpoint;
    this.cache.seenCheckpoints = stored.seenCheckpoints;
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
          this.options.wireCompression ??= 'gzip';
          if (this.options.wireCompression === 'gzip') requireNativeGzip();
          return await work();
        }
        catch (error) {
          // A failed transaction must be retried from durable state, not half-mutated in-memory metadata.
          this.cacheFingerprint = undefined;
          this.cache = emptyCache(); this.remoteCache = undefined; this.persistedReplay = undefined; this.replayFingerprint = undefined;
          this.coldHistory.clear(); this.persistedCommits.clear(); this.encodedCommits.clear();
          throw error;
        }
      };
      return typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`weavelet-google-sync:${this.dataset}`, guarded)
        : guarded();
    };
    const result = this.queue.then(task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  static async create<T extends SyncDataset>(transport: SyncTransport<T>, password: string, options: SyncTransferOptions & { folderName?: string } = {}): Promise<{ session: EncryptedSync; file: T }> {
    if (options.wireCompression !== 'legacy') requireNativeGzip(); // Fail before allocating IDs/folders/outboxes.
    // Derive the key before creating remote files, so invalid passphrases cannot create empty folders.
    const [dataset, header] = await transport.ids(2);
    syncPhase('key');
    const { key, envelope } = await createKeyEnvelope(password, dataset);
    const session = new EncryptedSync(dataset, transport, { ...options, wireCompression: options.wireCompression ?? 'gzip' });
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
    if (manifest.version !== 2 && (![1, 3, 4].includes(manifest.version) || !Array.isArray(manifest.parts) || !manifest.parts.length ||
        manifest.parts.some(p => typeof p !== 'string'))) throw new Error('Invalid sync commit.');
    return manifest;
  }

  private async loadCommit(id: string, manifests: Map<string, CommitManifest>): Promise<void> {
    if (this.hasCommit(id)) return;
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
      const decoded = manifest.version === 4 ? await decodeNativePartsAsync<Commit>(chunks)
        : manifest.version === 3 ? await decodeWirePartsAsync<Commit>(chunks) : await decodePartsAsync<Commit>(chunks);
      commit = decoded.value;
      payload = manifest.version === 4 ? frameCacheGzip(decoded.bytes)
        : manifest.version === 3 ? await encodeCacheAsync(commit) : decoded.bytes;
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
    if (![1, 2, 3].includes(pack.version) || !pack.commits || typeof pack.commits !== 'object' || Array.isArray(pack.commits) ||
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
    await this.hydrateHistory(Object.keys(pack.commits));
    const missing = Object.keys(pack.commits).some(commit => !this.cache.commits[commit]);
    // Authenticate the index against retained commits without downloading known payloads again.
    const retained = Object.fromEntries(Object.keys(pack.commits)
      .filter(commit => this.cache.commits[commit]).map(commit => [commit, this.cache.commits[commit]]));
    const retainedHashes = await (pack.version === 3 ? hashNativeCommitsAsync(retained) : hashCommitsAsync(retained));
    const retainedMismatch = Object.entries(retainedHashes).some(([commit, hash]) => hash !== pack.commits[commit]);
    // Different JSON key order can change legacy LZ hashes. Authenticate that pack independently before comparing logical values.
    if (!missing && !verify && !retainedMismatch) { recordPackAccess(true); return; }
    syncPhase('downloading', pack.parts.length);
    const chunks = await this.parallel(pack.parts, async (part) => {
      const bytes = await decrypt(this.requireKey(), await this.transport.read(part, verify ? 'verification' : 'pack'), this.context(part));
      completedFile(bytes.length);
      return bytes;
    });
    const size = chunks.reduce((total, bytes) => total + bytes.length, 0);
    if (size !== pack.bytes) throw new Error('Incomplete sync pack.');
    const { value: data } = pack.version === 3
      ? await decodeNativePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks)
      : pack.version === 2 ? await decodeWirePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks)
      : await decodePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks);
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
      encoded.set(commit, pack.version === 3 ? await encodeCacheAsync(value) : await encodeAsync(value));
    }
    const nativeHashes = pack.version === 3 ? await hashNativeCommitsAsync(data.commits) : undefined;
    for (const [commit, hash] of Object.entries(pack.commits)) if ((nativeHashes?.[commit] ?? await digest(encoded.get(commit)!)) !== hash) {
      throw new Error('Sync pack history mismatch.');
    }
    if (retainedMismatch) {
      const existing = await hashNativeCommitsAsync(retained);
      const received = nativeHashes ?? await hashNativeCommitsAsync(data.commits);
      if (Object.entries(existing).some(([id, hash]) => received[id] !== hash)) throw new Error('Sync pack history mismatch.');
    }
    if (!verify) recordPackAccess(false);
    // Never cache half a pack after failed authentication. Prefer existing legacy order when reading native packs.
    for (const [commit, bytes] of encoded) {
      const previous = this.cache.commits[commit];
      const chosen = pack.version === 3 && previous ? previous : data.commits[commit];
      if (previous && pack.version !== 3 && retainedHashes[commit] !== pack.commits[commit]) this.persistedCommits.delete(commit);
      this.cache.commits[commit] = chosen;
      if (!this.persistedCommits.has(commit)) this.encodedCommits.set(commit,
        chosen === data.commits[commit] ? bytes : await encodeCacheAsync(chosen));
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
      const initial = !this.cache.token;
      const ids = new Set<string>();
      if (!this.cache.token) {
        const token = await this.transport.startToken();
        const history = await this.transport.history(this.dataset);
        await this.discoverPacks(history.packs);
        for (const id of history.commits) ids.add(id);
        this.cache.token = token;
      }
      const page = await this.transport.changes(this.cache.token!);
      const removed = new Set(page.changes.filter(change => change.removed).map(change => change.id));
      if (removed.has(this.dataset)) throw new Error('Sync folder was deleted from storage; sync stopped.');
      const oldPacks = this.cache.packs ?? {};
      const removedPacks = Object.entries(oldPacks).filter(([id]) => removed.has(id));
      const packChanged = page.changes.some(change => change.dataset === this.dataset &&
        change.kind === 'pack') || removedPacks.length > 0;
      // Query live indexes rather than reading stale creation events followed by deletion events.
      if (packChanged || [...removed].some(id => this.hasCommit(id) || ids.has(id))) await this.discoverPacks();
      const covered = this.packedCommits();
      for (const [, pack] of removedPacks) if (Object.keys(pack.commits).some(id => !covered.has(id))) {
        throw new Error('Sync history was deleted from storage; sync stopped.');
      }
      for (const id of removed) {
        if ((this.hasCommit(id) || ids.has(id)) && !covered.has(id)) {
          throw new Error('Sync history was deleted from storage; sync stopped.');
        }
        ids.delete(id);
      }
      for (const change of page.changes) {
        if (change.dataset === this.dataset && change.kind === 'commit' &&
            !removed.has(change.id)) ids.add(change.id);
      }
      const missing = [...ids].filter(id => !this.hasCommit(id));
      if (missing.length) {
        syncPhase('downloading');
        const manifests = new Map<string, CommitManifest>();
        let partCount = 0;
        const unbundled = missing.filter(id => !covered.has(id));
        const downloaded = await this.parallel(unbundled, async (id) => [id, await this.downloadManifest(id)] as const);
        for (const [id, manifest] of downloaded) {
          manifests.set(id, manifest);
          if (manifest.version !== 2) partCount += manifest.parts!.length;
        }
        syncPhase('downloading', missing.length + partCount, undefined, missing.length);
        for (const id of missing) await this.loadCommit(id, manifests);
      }
      for (const commit of Object.values(this.cache.commits)) for (const parent of commit.parents) {
        if (!this.hasCommit(parent)) await this.loadCommit(parent, new Map());
      }
      if (initial || page.changes.some(change => change.dataset === this.dataset && change.kind === 'checkpoint' && !change.removed)) {
        await this.discoverCheckpoints();
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
  private async readCheckpoint(id: string): Promise<{ chunks: Uint8Array[]; stateRoot: string }> {
    const manifest = await decodeAsync<CheckpointManifest>(await decrypt(this.requireKey(),
      await this.transport.read(id), this.context(id)));
    if (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length ||
        manifest.parts.some(part => typeof part !== 'string' || !/^[A-Za-z0-9_-]+$/.test(part) || part === id) ||
        new Set(manifest.parts).size !== manifest.parts.length || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 ||
        typeof manifest.stateRoot !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.stateRoot)) throw new Error('Invalid sync checkpoint manifest.');
    syncPhase('downloading', manifest.parts.length);
    const chunks = await this.parallel(manifest.parts, async part => {
      const bytes = await decrypt(this.requireKey(), await this.transport.read(part), this.context(part));
      completedFile(bytes.length);
      return bytes;
    });
    if (chunks.reduce((size, bytes) => size + bytes.length, 0) !== manifest.bytes) throw new Error('Incomplete sync checkpoint.');
    return { chunks, stateRoot: manifest.stateRoot };
  }
  private async discoverCheckpoints() {
    if (!this.transport.checkpoints) return;
    const seen = new Set(this.cache.seenCheckpoints ?? []);
    for (const id of await this.transport.checkpoints(this.dataset)) {
      if (seen.has(id) || id === this.cache.checkpointUpload?.id) continue;
      try {
        const encoded = await this.readCheckpoint(id);
        // Decode and exact history verification share one Worker invocation, avoiding a full snapshot round trip.
        await this.hydrateHistory();
        syncPhase('verifying');
        const checkpoint = await decodeVerifyCheckpointAsync({ ...encoded, commits: this.cache.commits });
        const ids = Object.keys(checkpoint.commits);
        if (!this.remoteCache || checkpoint.tips.length === 1 && ids.length > this.remoteCache.commits.length) {
          this.remoteCache = { version: 1, commits: ids.sort(), tips: checkpoint.tips,
            records: checkpoint.records, conflicts: checkpoint.conflicts };
        }
        if (!this.cache.lastCheckpoint || ids.length > this.cache.lastCheckpoint.commits.length) {
          this.cache.lastCheckpoint = { id, commits: ids };
        }
      } catch {
        // Disposable acceleration must never replace or block recovery from the authoritative commit history.
      }
      // Published files are immutable: a rejected hint cannot become valid without a new ID.
      seen.add(id);
    }
    this.cache.seenCheckpoints = [...seen];
  }
  private async finishCheckpoint() {
    const pending = this.cache.checkpointUpload;
    if (!pending) return;
    await this.sendFiles(pending, 'checkpoint');
    let received: { chunks: Uint8Array[]; stateRoot: string };
    try { received = await this.readCheckpoint(pending.id); }
    catch (error) {
      if (!(error instanceof SyncFileNotFoundError)) throw error;
      // An ACK proves a previous write, not current existence. Repair only with the original durable ciphertext.
      await writeSyncCache(this.dataset, undefined, [], pending.files.map(file => `ack:${file.id}`));
      for (const file of pending.files) file.sent = false;
      await this.sendFiles(pending, 'checkpoint');
      received = await this.readCheckpoint(pending.id);
    }
    await this.hydrateHistory(pending.commits);
    syncPhase('verifying');
    const checkpoint = await decodeVerifyCheckpointAsync({ ...received, expectedCommitIds: pending.commits,
      commits: Object.fromEntries(pending.commits.map(id => [id, this.cache.commits[id]])) });
    if (checkpoint.stateRoot !== pending.manifest.stateRoot) throw new Error('Sync checkpoint publication mismatch.');
    this.cache.lastCheckpoint = { id: pending.id, commits: pending.commits };
    if (!this.remoteCache || pending.commits.length >= this.remoteCache.commits.length) {
      this.remoteCache = { version: 1, commits: [...pending.commits].sort(), tips: checkpoint.tips,
        records: checkpoint.records, conflicts: checkpoint.conflicts };
    }
    this.cache.seenCheckpoints = [...new Set([...(this.cache.seenCheckpoints ?? []), pending.id])];
    delete this.cache.checkpointUpload;
    await this.save(pending.files.flatMap(file => [`outbox:${file.id}`, `ack:${file.id}`]), true);
  }
  private async checkpoint(force = false) {
    await this.finishCheckpoint();
    if (!this.transport.checkpoints || this.options.wireCompression !== 'gzip' || !this.commitIds().length) return;
    const previous = new Set(this.cache.lastCheckpoint?.commits ?? []);
    const added = this.commitIds().filter(id => !previous.has(id));
    // Checkpoint cadence is not history retention: every original logical commit remains available.
    if (previous.size && (!added.length || !force && added.length < COMPACT_COMMITS)) return;
    await this.hydrateHistory();
    const checkpoint = await createEncodedCheckpointAsync({ commits: this.cache.commits, tips: this.heads() });
    syncPhase('encrypting');
    const { payload } = checkpoint;
    const partBytes = this.options.partBytes ?? PART_BYTES;
    const [id, ...parts] = await this.transport.ids(1 + Math.ceil(payload.length / partBytes));
    const files: Pending['files'] = [];
    for (let i = 0; i < parts.length; i++) {
      const bytes = await encrypt(this.requireKey(), payload.slice(i * partBytes, (i + 1) * partBytes), this.context(parts[i]));
      files.push({ id: parts[i], kind: 'checkpoint-part', bytes, size: bytes.length, sent: false });
    }
    const manifest: CheckpointManifest = { version: 1, parts, bytes: payload.length, stateRoot: checkpoint.stateRoot };
    const bytes = await encrypt(this.requireKey(), await encodeAsync(manifest), this.context(id));
    files.push({ id, kind: 'checkpoint', bytes, size: bytes.length, sent: false });
    this.cache.checkpointUpload = { id, manifest, commits: checkpoint.commits, files };
    await this.save();
    await this.finishCheckpoint();
  }
  private async checkpointAutomatic(force = false) {
    try { await this.checkpoint(force); }
    catch {
      // This is replaceable acceleration, not the data publication boundary. In particular an aggregate checkpoint
      // may exceed the per-payload budget while every accepted commit is valid. Preserve any durable outbox for retry.
    }
  }
  async checkpointHistory(): Promise<void> {
    await this.run(async () => {
      await this.sendPending(); await this.finishCompaction(); await this.refresh();
      await this.remote(); await this.checkpoint(true);
    });
  }
  private heads(): string[] {
    const ids = this.commitIds();
    const parents = new Set(ids.flatMap(id => this.parentsOf(id)));
    return ids.filter(id => !parents.has(id)).sort();
  }
  private async remote(allowConflicts = false, tips?: string[]): Promise<Records> {
    syncPhase('verifying');
    const heads = tips ?? this.heads();
    const ids = this.commitIds().sort();
    const cached = tips ? undefined : this.remoteCache;
    let result = cached && JSON.stringify(cached.commits) === JSON.stringify(ids) &&
      JSON.stringify(cached.tips) === JSON.stringify(heads) ? cached : undefined;
    // Only a direct, single-head continuation can discard per-key ancestry information.
    // Deletions/presentation changes can repair activePath; retain the full replay for those cases.
    if (!result && cached?.tips.length === 1 && !Object.keys(cached.conflicts).length &&
        ids.length > cached.commits.length && cached.commits.every(id => this.hasCommit(id))) {
      const known = new Set(cached.commits);
      const added = ids.filter(id => !known.has(id));
      const children = new Map<string, string>();
      const direct = added.every(id => {
        const commit = this.cache.commits[id];
        if (!commit || commit.parents.length !== 1 || children.has(commit.parents[0]) || commit.resolutions) return false;
        children.set(commit.parents[0], id);
        return commit.changes.every(change => {
            if (change.after === null || isNonBlockingRecord(change.key)) return false;
            const path = JSON.parse(change.key);
            // Restoring a previously deleted node can restore an old activePath during full replay.
            return path[0] !== 'chats' || !['id', 'parentId', 'rootId'].includes(path[path.length - 1]);
          });
      });
      if (heads.length === 1 && direct) {
        try {
          let records = cached.records, head = cached.tips[0], count = 0;
          while (children.has(head) && count < added.length) {
            head = children.get(head)!;
            const changes = this.cache.commits[head].changes;
            records = await applyChanges(records, changes);
            for (const change of changes) {
              const time = mergeEditTimes(change.key, [change.after]);
              if (time !== undefined) records[change.key] = time;
            }
            if (++count % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          }
          if (count === added.length && head === heads[0]) result = { ...cached, records };
        }
        catch { /* Preserve full replay validation and its error semantics. */ }
      }
    }
    if (!result) await this.hydrateHistory();
    const { records, conflicts } = result ?? await replayHistoryAsync({ commits: this.cache.commits, tips: heads });
    if (!tips && (!cached || result !== cached)) {
      this.remoteCache = { version: 1, commits: ids, tips: heads, records, conflicts };
      await this.save();
    }
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
    if (pending.baseline) this.cache.baseline = pending.baseline;
    delete this.cache.pending;
    await this.save(pending.files.flatMap(f => [`outbox:${f.id}`, `ack:${f.id}`]));
  }
  private async finishCompaction() {
    // Checkpoint failure must not prevent publishing or recovering authoritative commits.
    await this.finishCheckpoint().catch(() => {});
    const pending = this.cache.compaction;
    if (!pending) return;
    await this.hydrateHistory(Object.keys(pending.manifest.commits));
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
      // Authenticate the pending representation before discovery can select an equivalent legacy JSON key order.
      const retained = Object.fromEntries(Object.keys(pending.manifest.commits).filter(id => this.cache.commits[id])
        .map(id => [id, this.cache.commits[id]]));
      const expected = await (pending.manifest.version === 3 ? hashNativeCommitsAsync(retained) : hashCommitsAsync(retained));
      if (Object.entries(pending.manifest.commits).some(([id, hash]) => expected[id] !== hash)) {
        // A previous cleanup attempt may already have persisted another equivalent key order.
        // The immutable local outbox still contains the original published representation until cleanup completes.
        const saved = await readSyncEntries(this.dataset, pending.manifest.parts.map(id => `outbox:${id}`));
        const chunks = await this.parallel(pending.manifest.parts.map((id, index) => ({ id, bytes: saved[index] })), async ({ id, bytes }) => {
          if (!bytes) throw new Error('Missing local upload data.');
          return decrypt(this.requireKey(), bytes, this.context(id));
        });
        if (chunks.reduce((size, bytes) => size + bytes.length, 0) !== pending.manifest.bytes) throw new Error('Missing compacted sync history.');
        const { value: original } = pending.manifest.version === 3
          ? await decodeNativePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks)
          : pending.manifest.version === 2 ? await decodeWirePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks)
          : await decodePartsAsync<{ version: number; commits: Record<string, Commit> }>(chunks);
        if (original.version !== 1 || !original.commits || Object.keys(original.commits).length !== Object.keys(pending.manifest.commits).length) {
          throw new Error('Missing compacted sync history.');
        }
        const hashes = await (pending.manifest.version === 3 ? hashNativeCommitsAsync(original.commits) : hashCommitsAsync(original.commits));
        const canonical = await hashNativeCommitsAsync(original.commits), current = await hashNativeCommitsAsync(retained);
        if (Object.entries(pending.manifest.commits).some(([id, hash]) => hashes[id] !== hash || canonical[id] !== current[id])) {
          throw new Error('Missing compacted sync history.');
        }
      }
      // Another device can consolidate this pack with its own hash rule or canonical-equivalent representation.
      await this.discoverPacks();
      const replacements = Object.values(this.cache.packs ?? {}).filter(pack =>
        Object.keys(pack.commits).some(id => Object.hasOwn(pending.manifest.commits, id)));
      for (const id of Object.keys(pending.manifest.commits)) if (!replacements.some(pack => Object.hasOwn(pack.commits, id))) {
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
    if (this.commitIds().filter(id => !covered.has(id)).length < (force ? 1 : COMPACT_COMMITS)) {
      reportCompaction({ status: 'skipped', reason: 'belowThreshold' }); return;
    }
    // Capture live sources once. Commits published by another device later are never deletion targets.
    await this.discoverPacks();
    const raw = await this.transport.commits(this.dataset);
    if (raw.length < (force ? 1 : COMPACT_COMMITS)) { reportCompaction({ status: 'skipped', reason: 'liveBelowThreshold' }); return; }
    await this.hydrateHistory();
    const native = this.options.wireCompression === 'gzip';
    if (native) requireNativeGzip();
    const groups: { commits: string[]; sources: string[]; size: number }[] = [];
    let group = { commits: [] as string[], sources: [] as string[], size: 0 };
    for (const id of raw.sort()) {
      const commit = this.cache.commits[id];
      if (!commit) continue; // A concurrent publication belongs to the next synchronization.
      // Native groups use a conservative uncompressed estimate; final payloads are still split by actual bytes.
      const estimated = native ? nativeCommitByteBound(commit) : (await encodeAsync(commit)).length;
      const size = Math.max(estimated, id.length + 128);
      if (group.commits.length && group.size + size > PACK_BYTES) {
        groups.push(group); group = { commits: [], sources: [], size: 0 };
      }
      const parts = this.cache.parts?.[id] ?? (await this.downloadManifest(id)).parts ?? [];
      group.commits.push(id); group.sources.push(id, ...parts); group.size += size;
    }
    if (group.commits.length) groups.push(group);
    // Fold small existing packs into the new group; do not rewrite full packs on every edit.
    for (const [id, pack] of Object.entries(this.cache.packs ?? {})) {
      const size = native ? Object.keys(pack.commits).reduce((sum, id) => sum + nativeCommitByteBound(this.cache.commits[id]), 0)
        : Math.max(pack.bytes, Object.keys(pack.commits).reduce((sum, commit) => sum + commit.length + 128, 0));
      const target = groups.find(group => group.size + size <= PACK_BYTES);
      if (!target) continue;
      target.commits.push(...Object.keys(pack.commits)); target.sources.push(id, ...pack.parts); target.size += size;
    }
    for (const group of groups) {
      const commits = Object.fromEntries([...new Set(group.commits)].sort().map(id => [id, this.cache.commits[id]]));
      const value = { version: 1 as const, commits };
      const logical = native ? undefined : await encodeAsync(value);
      const payload = native ? await encodeNativeAsync(value)
        : this.options.wireDelta ? await encodeWireAsync(value, logical) : logical!;
      const hashes = await (native ? hashNativeCommitsAsync(commits) : hashCommitsAsync(commits));
      const [id, ...parts] = await this.transport.ids(1 + Math.ceil(payload.length / PACK_BYTES));
      const files: Pending['files'] = [];
      for (let i = 0; i < parts.length; i++) {
        const bytes = await encrypt(this.requireKey(), payload.slice(i * PACK_BYTES, (i + 1) * PACK_BYTES), this.context(parts[i]));
        files.push({ id: parts[i], kind: 'pack-part', bytes, size: bytes.length, sent: false });
      }
      const manifest: PackManifest = { version: native ? 3 : payload.length < logical!.length ? 2 : 1, commits: hashes, parts, bytes: payload.length };
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
    const gzip = this.options.wireCompression === 'gzip';
    const boundedInline = gzip && commit.parents.length > 0 && nativeCommitByteBound(commit) <= INLINE_JSON_BOUND;
    const logical = !gzip || boundedInline ? await encodeAsync(commit) : undefined;
    const native = gzip && (!boundedInline || logical!.length > INLINE_BYTES);
    if (native) requireNativeGzip();
    // Native mode uses old inline LZ only for bounded small updates; large bodies never enter JavaScript LZ.
    const payload = native ? await encodeNativeAsync(commit)
      : !gzip && this.options.wireDelta ? await encodeWireAsync(commit, logical) : logical!;
    const delta = !native && payload.length < logical!.length;
    const inline = !native && !delta && commit.parents.length > 0 && payload.length <= INLINE_BYTES;
    const partBytes = this.options.partBytes ?? PART_BYTES;
    const [id, ...parts] = await this.transport.ids(inline ? 1 : 1 + Math.ceil(payload.length / partBytes));
    syncPhase('encrypting', parts.length + 1);
    const files: Pending['files'] = [];
    for (let i = 0; i < parts.length; i++) {
      const bytes = await encrypt(this.requireKey(), payload.slice(i * partBytes, (i + 1) * partBytes), this.context(parts[i]));
      files.push({ id: parts[i], kind: 'part', bytes, size: bytes.length, sent: false });
      completedFile(bytes.length);
    }
    const bytes = await encrypt(this.requireKey(), await encodeAsync(inline ? { ...commit, version: 2 } : { version: native ? 4 : delta ? 3 : 1, parts }), this.context(id));
    files.push({ id, kind: 'commit', bytes, size: bytes.length, sent: false });
    completedFile(bytes.length);
    this.encodedCommits.set(id, native ? frameCacheGzip(payload) : logical!);
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
      await syncStage(5, 6, async () => { await this.compact(); await this.refresh(); await this.remote(); await this.checkpointAutomatic(); });
    });
  }

  async compactHistory(): Promise<void> {
    await this.run(async () => {
      await syncStage(0, 4, async () => { await this.sendPending(); await this.finishCompaction(); });
      await syncStage(1, 4, () => this.refresh());
      await syncStage(2, 4, () => this.remote());
      await syncStage(3, 4, async () => { await this.compact(true); await this.checkpointAutomatic(true); });
    });
  }

  async synchronize(snapshot: Snapshot, replace: boolean | 'if-empty' = false): Promise<Snapshot> {
    syncPhase('preparing');
    const local = await syncStage(0, 8, () => toRecords(snapshot));
    return this.run(async () => {
      await syncStage(1, 8, async () => { await this.sendPending(); await this.finishCompaction(); });
      await syncStage(2, 8, () => this.refresh());
      const remote = await syncStage(3, 8, () => this.remote());
      const { localHashes, changes, validatedSnapshot, validatedRecords } = await syncStage(4, 8, async () => {
        syncPhase('preparing');
        if (replace === 'if-empty' && !this.cache.baseline && Object.keys(remote).length) throw new Error('Existing history must be downloaded before initializing sync.');
        if (!replace && !this.cache.baseline) throw new Error('Choose upload or download before enabling automatic sync.');
        const base = replace === true || (replace === 'if-empty' && !this.cache.baseline) ? await hashRecords(remote) : this.cache.baseline!;
        const localHashes = await hashRecords(local);
        const changes = await Promise.all(diffHashedRecords(base, local, localHashes).filter((change) => {
          if (isBrowserLocalRecord(change.key)) return false;
          // Content and assets are immutable and may be referenced by another device. Never GC them from a local snapshot.
          const path = JSON.parse(change.key);
          // A stale local baseline may not include an immutable body already published by another device.
          // Only byte-identical remote values qualify; differing data must retain its conflict checks.
          if ((path[0] === 'content' || path[0] === 'assets') && change.after === remote[change.key]) return false;
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
        let validatedSnapshot: Snapshot;
        try { validatedSnapshot = await fromRecords(merged, snapshot.state.contentStore); }
        catch (error) {
          // Two valid edits can conflict structurally (for example, deleting a branch another device extends).
          await fromRecords(local); await fromRecords(remote);
          throw new SyncConflictError(changes.map(change => change.key));
        }
        return { localHashes, changes, validatedSnapshot, validatedRecords: merged };
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
        const records = await this.remote(); // Detect concurrent conflicting publications and cleanup before reporting success.
        await this.checkpointAutomatic();
        return records;
      });
      // The publication/refresh can add concurrent data. Reuse validation only when every final record is unchanged.
      return sameRecords(finalRemote, validatedRecords) ? validatedSnapshot : fromRecords(finalRemote, snapshot.state.contentStore);
    });
  }

  async push(snapshot: Snapshot, replace: boolean | 'if-empty' = false): Promise<void> {
    await this.synchronize(snapshot, replace);
  }

  private async coherentCloudRecords(remote: Records): Promise<Records> {
    let cloud = remote;
    if (Object.keys(this.remoteConflicts).length) {
      await this.hydrateHistory();
      // Each head is a complete view. Merge coherent views rather than picking unrelated node fields.
      const heads = this.heads();
      const sets: Set<string>[] = [];
      for (const id of heads) sets.push(await collectHistoryAsync({ commits: this.cache.commits, tips: [id] }));
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
        const result = await fromRecords(chosen, snapshot.state.contentStore);
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
