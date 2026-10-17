// Synthetic data only. Run in separate processes for each scale/entropy/engine.
// SYNC_SCALE_BENCH=1 SYNC_SCALE_BENCH_SCALE=3 yarn vitest run <this file>
import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { writeFileSync } from 'node:fs';
import { EncryptedSync } from '../sync/EncryptedSync';
import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from '../sync/transport';
import { createSyntheticSnapshot, SYNTHETIC_PROFILE } from './synthetic';
import { clearRecordCaches, getRecordCacheStats } from './recordCache';
import { getSyncMetrics, resetSyncMetrics } from './metrics';
import { addContent, addContentDelta, resolveContentStrict } from '@utils/contentStore';
import type { Snapshot } from './records';

class MemoryTransport implements SyncTransport {
  next = 0;
  headers = new Map<string, string>();
  files = new Map<string, { dataset: string; kind: string; bytes: Uint8Array }>();
  events: SyncChange[] = [];
  uploadedBytes = 0;
  downloadedBytes = 0;
  calls: Record<string, number> = {};
  count(method: string) { this.calls[method] = (this.calls[method] ?? 0) + 1; }
  reset() { this.uploadedBytes = this.downloadedBytes = 0; this.calls = {}; }
  async ids(count: number) { this.count('ids'); return Array.from({ length: count }, () => `synthetic-file-${++this.next}`); }
  async folder(id: string, header: string) { this.count('folder'); this.headers.set(id, header); return { id }; }
  async keyHeader(dataset: string) {
    this.count('keyHeader'); const header = this.headers.get(dataset);
    if (!header) throw new SyncFileNotFoundError('Missing synthetic dataset.');
    return header;
  }
  async read(id: string) {
    this.count('read'); const file = this.files.get(id);
    if (!file) throw new SyncFileNotFoundError('Missing synthetic file.');
    this.downloadedBytes += file.bytes.length; return file.bytes.slice();
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
    this.count('put'); this.uploadedBytes += bytes.length;
    const existing = this.files.get(id);
    if (existing) {
      if (!Buffer.from(existing.bytes).equals(Buffer.from(bytes))) throw new Error('Immutable file changed.');
      return;
    }
    this.files.set(id, { dataset, kind, bytes: bytes.slice() });
    this.events.push({ id, dataset, kind });
  }
  async startToken() { this.count('startToken'); return String(this.events.length); }
  list(dataset: string, kind: string) {
    return [...this.files].filter(([, file]) => file.dataset === dataset && file.kind === kind).map(([id]) => id);
  }
  async history(dataset: string) { this.count('history'); return { commits: this.list(dataset, 'commit'), packs: this.list(dataset, 'pack') }; }
  async commits(dataset: string) { this.count('commits'); return this.list(dataset, 'commit'); }
  async packs(dataset: string) { this.count('packs'); return this.list(dataset, 'pack'); }
  async changes(token: string) { this.count('changes'); return { token: String(this.events.length), changes: this.events.slice(Number(token)) }; }
  async remove(id: string) { this.count('remove'); if (this.files.delete(id)) this.events.push({ id, removed: true }); }
}

async function localEncryptedBytes() {
  return new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('weavelet-google-sync');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([...db.objectStoreNames], 'readonly');
      const reads = [...db.objectStoreNames].map(name => tx.objectStore(name).getAll());
      const size = (value: unknown): number => value instanceof Uint8Array ? value.byteLength :
        value && typeof value === 'object' ? Object.values(value).reduce<number>((n, item) => n + size(item), 0) : 0;
      tx.oncomplete = () => { db.close(); resolve(reads.reduce((n, read) => n + size(read.result), 0)); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

it.skipIf(!process.env.SYNC_SCALE_BENCH)('measures realistic synthetic sync scenarios without exposing bodies', async () => {
  const base = process.env.SYNC_SCALE_BENCH_BASE;
  const Engine = base ? (await import(`${base}/sync.ts`)).EncryptedDriveSync as typeof EncryptedSync : EncryptedSync;
  const metrics = base ? await import(`${base}/metrics.ts`) : { getSyncMetrics, resetSyncMetrics };
  const recordCache = base ? { clearRecordCaches: () => {}, getRecordCacheStats: () => ({}) } : { clearRecordCaches, getRecordCacheStats };
  const smoke = !!process.env.SYNC_SCALE_BENCH_SMOKE;
  const profile = smoke ? { ...SYNTHETIC_PROFILE, treeChats: 2, treeNodes: 24, legacyChats: 3,
    legacyNodes: 30, maxTreeNodes: 16, maxDepth: 6, maxFanout: 5 } : SYNTHETIC_PROFILE;
  const options = {
    scale: Number(process.env.SYNC_SCALE_BENCH_SCALE ?? 1),
    seed: Number(process.env.SYNC_SCALE_BENCH_SEED ?? 1),
    bodyBytes: Number(process.env.SYNC_SCALE_BENCH_BODY_BYTES ?? (smoke ? 256 : 5200)),
    sharedRatio: Number(process.env.SYNC_SCALE_BENCH_SHARED_RATIO ?? 0.5),
    editRatio: Number(process.env.SYNC_SCALE_BENCH_EDIT_RATIO ?? 0),
    incompressible: !!process.env.SYNC_SCALE_BENCH_INCOMPRESSIBLE,
    profile,
  };
  let snapshot = createSyntheticSnapshot(options);
  const inputBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const expectedChats = (profile.treeChats + profile.legacyChats) * options.scale;
  const expectedNodes = (profile.treeNodes + profile.legacyNodes) * options.scale;
  const validate = (value: Snapshot) => {
    expect(value.state.chats).toHaveLength(expectedChats);
    expect(value.state.chats!.reduce((n, chat) => n + (chat.branchTree ? Object.keys(chat.branchTree.nodes).length : chat.messages?.length ?? 0), 0)).toBe(expectedNodes);
  };
  globalThis.indexedDB = new IDBFactory(); recordCache.clearRecordCaches();
  const transport = new MemoryTransport();
  const password = 'synthetic benchmark password';
  let session!: EncryptedSync, dataset = '';
  const scenarios: Record<string, unknown> = {};
  const result = { engine: base ?? 'current', node: process.version, platform: process.platform,
    options, inputBytes, targetJsonBytes: profile.targetJsonBytes * options.scale,
    chats: expectedChats, nodes: expectedNodes, complete: false,
    limitations: 'Zero network latency; fake IndexedDB; no browser Worker/copy measurement. Memory sampling can miss synchronous peaks; high-water RSS is process-wide.',
    scenarios };
  const saveReport = () => {
    if (process.env.SYNC_SCALE_BENCH_OUTPUT) writeFileSync(process.env.SYNC_SCALE_BENCH_OUTPUT, JSON.stringify(result, null, 2));
  };
  const measure = async (name: string, work: () => Promise<Snapshot>) => {
    transport.reset(); metrics.resetSyncMetrics();
    const cacheBefore = recordCache.getRecordCacheStats();
    const memoryBefore = process.memoryUsage();
    let peakRss = memoryBefore.rss, peakHeap = memoryBefore.heapUsed;
    const sample = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); };
    const sampler = setInterval(sample, 25);
    const started = performance.now();
    let received: Snapshot;
    try { received = await work(); } finally { clearInterval(sampler); }
    const ms = performance.now() - started;
    sample();
    scenarios[name] = {
      ms, uploadedBytes: transport.uploadedBytes, downloadedBytes: transport.downloadedBytes,
      transportCalls: { ...transport.calls },
      remoteStorageBytes: [...transport.files.values()].reduce((n, file) => n + file.bytes.length, 0),
      localEncryptedStorageBytes: await localEncryptedBytes(),
      metrics: metrics.getSyncMetrics(), cacheBefore, cacheAfter: recordCache.getRecordCacheStats(),
      memory: { before: memoryBefore, after: process.memoryUsage(), sampledPeakRss: peakRss,
        sampledPeakHeap: peakHeap, processHighWaterRssBytes: process.resourceUsage().maxRSS * 1024 },
    };
    validate(received!); // Correctness work stays outside the measured duration.
    snapshot = received!;
    saveReport();
    console.info('SYNC_SCALE_SCENARIO', JSON.stringify({ name, ms,
      uploadedBytes: transport.uploadedBytes, downloadedBytes: transport.downloadedBytes }));
  };
  const sync = async (replace = false) => {
    const target = session as EncryptedSync & { synchronize?: (value: Snapshot, replace: boolean) => Promise<Snapshot> };
    if (target.synchronize) return target.synchronize(snapshot, replace);
    await target.push(snapshot, replace); return target.pull();
  };
  await measure('initial', async () => {
    const created = await Engine.create(transport, password);
    session = created.session; dataset = created.file.id;
    return sync(true);
  });
  await measure('unchanged', () => sync());
  const treeChat = () => snapshot.state.chats!.find(chat => chat.branchTree)!;
  treeChat().title = 'Synthetic edited title';
  await measure('titleEdit', () => sync());
  expect(treeChat().title).toBe('Synthetic edited title');
  const firstNode = () => Object.values(treeChat().branchTree!.nodes)[0];
  const original = resolveContentStrict(snapshot.state.contentStore!, firstNode().contentHash);
  const edited = structuredClone(original);
  if (edited[0].type !== 'text') throw new Error('Synthetic text expected.');
  edited[0].text += ' Synthetic local edit.';
  firstNode().contentHash = addContentDelta(snapshot.state.contentStore!, edited, firstNode().contentHash);
  await measure('bodyEdit', () => sync());
  expect(resolveContentStrict(snapshot.state.contentStore!, firstNode().contentHash)).toEqual(edited);
  const nodes = Object.values(treeChat().branchTree!.nodes);
  const reused = resolveContentStrict(snapshot.state.contentStore!, nodes[0].contentHash);
  nodes[1].contentHash = addContent(snapshot.state.contentStore!, reused);
  await measure('sharedBody', () => sync());
  const sharedNodes = Object.values(treeChat().branchTree!.nodes);
  expect(sharedNodes[0].contentHash).toBe(sharedNodes[1].contentHash);
  recordCache.clearRecordCaches();
  await measure('restartPull', async () => {
    session = new Engine(dataset, transport);
    await session.unlock(password); return session.pull();
  });
  expect(treeChat().title).toBe('Synthetic edited title');
  expect(resolveContentStrict(snapshot.state.contentStore!, firstNode().contentHash)).toEqual(edited);
  result.complete = true;
  saveReport();
  console.info('SYNC_SCALE_BENCH', JSON.stringify(result));
}, 1_800_000);
