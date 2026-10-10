// Run with SYNC_BENCH=1 vitest run src/store/storage/google/benchmark.test.ts --testTimeout=1800000.
// Synthetic data only. The optional SYNC_BENCH_BASE is an instrumented pre-change module directory.
import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { EncryptedDriveSync } from './sync';
import { resetSyncMetrics, getSyncMetrics } from './metrics';
import type { DriveTransport } from './transport';
import { toRecords, type Snapshot } from './records';
import { withSyncProgress, useGoogleSyncProgress } from './progress';

it.skipIf(!process.env.SYNC_BENCH)('measures a 32 MiB initial snapshot and one title edit', async () => {
  const base = process.env.SYNC_BENCH_BASE;
  const Engine = base ? (await import(`${base}/sync.ts`)).EncryptedDriveSync : EncryptedDriveSync;
  const metrics = base ? await import(`${base}/metrics.ts`) : { resetSyncMetrics, getSyncMetrics };
  (globalThis as any).indexedDB = new IDBFactory();
  let next = 0, requests = 0, bytes = 0, inflight = 0, peak = 0, uploadStart = 0, uploadEnd = 0;
  const files = new Map<string, { data: Uint8Array; metadata: any }>();
  const events: any[] = [];
  const latencyMs = Number(process.env.SYNC_BENCH_LATENCY ?? 20);
  const methods: Record<string, number> = {};
  const wait = async (method: string, size = 0) => {
    requests++; methods[method] = (methods[method] ?? 0) + 1;
    const latency = process.env.SYNC_BENCH_VARIED && requests % 3 === 0 ? latencyMs / 10 : latencyMs;
    await new Promise(r => setTimeout(r, latency + size / (5 * 1024 * 1024) * 1000));
  };
  const drive = {
    async id() { await wait('ids'); return `f${++next}`; },
    async ids(count: number) { await wait('ids'); return Array.from({ length: count }, () => `f${++next}`); },
    async folder(id: string, headerId: string) { await wait('folder'); return { id, mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId } }; },
    async put(id: string, dataset: string, kind: string, data: Uint8Array) {
      if (kind !== 'key' && !uploadStart) uploadStart = performance.now();
      inflight++; peak = Math.max(peak, inflight);
      await wait('put', data.length); inflight--; bytes += data.length; uploadEnd = performance.now();
      if (!files.has(id)) {
        const metadata = { id, appProperties: { dataset, kind } };
        files.set(id, { data: data.slice(), metadata }); events.push({ fileId: id, file: metadata });
      }
    },
    async read(id: string) { await wait('read'); return files.get(id)!.data.slice(); },
    async startToken() { await wait('startToken'); return String(events.length); },
    async commits() { await wait('commits'); return [...files.values()].filter(f => f.metadata.appProperties.kind === 'commit').map(f => f.metadata.id); },
    async packs() { await wait('packs'); return []; },
    async changes(token: string) { await wait('changes'); return { token: String(events.length), changes: events.slice(Number(token)).map(event => ({ ...event, id: event.fileId, dataset: event.file.appProperties.dataset, kind: event.file.appProperties.kind })) }; },
  } as unknown as DriveTransport;
  const image = 'data:image/png;base64,' + randomBytes(Number(process.env.SYNC_BENCH_IMAGE_BYTES ?? 1536 * 1024)).toString('base64');
  const textBytes = Number(process.env.SYNC_BENCH_TEXT_BYTES ?? 30 * 1024 * 1024);
  const text = 'Synthetic conversation for synchronization benchmarking. '.repeat(Math.ceil(textBytes / 55)).slice(0, textBytes);
  const snapshot = { version: 18, state: { chats: [{ id: 'bench', title: 'before', messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] }] }], contentStore: {}, theme: 'dark' } } as Snapshot;
  metrics.resetSyncMetrics();
  const started = performance.now();
  const { session } = await Engine.create(drive, 'synthetic benchmark password', { partBytes: Number(process.env.SYNC_BENCH_PART ?? 262144), concurrency: Number(process.env.SYNC_BENCH_CONCURRENCY ?? 1) });
  let completedAt = 0;
  let completedMetrics: ReturnType<typeof getSyncMetrics> = {};
  const synchronize = async (replace = false) => {
    const target = session as typeof session & { synchronize?: (value: Snapshot, replace: boolean) => Promise<Snapshot> };
    const received = await withSyncProgress(async () => {
      if (target.synchronize) return target.synchronize(snapshot, replace);
      await target.push(snapshot, replace);
      return target.pull();
    });
    completedAt = performance.now();
    completedMetrics = metrics.getSyncMetrics();
    expect(await toRecords(received)).toEqual(await toRecords(snapshot));
    expect(useGoogleSyncProgress.getState().active).toBe(false);
    expect(useGoogleSyncProgress.getState().overallProgress).toBe(1);
  };
  await synchronize(true);
  const first = { ms: completedAt - started, tailMs: completedAt - uploadEnd, requests, methods: { ...methods }, bytes, peak, uploadMs: uploadEnd - uploadStart, metrics: completedMetrics };
  requests = bytes = peak = 0;
  for (const key of Object.keys(methods)) delete methods[key];
  metrics.resetSyncMetrics();
  snapshot.state.chats![0].title = 'after';
  const edited = performance.now();
  await synchronize();
  const delta = { ms: completedAt - edited, tailMs: completedAt - uploadEnd, requests, methods: { ...methods }, bytes, metrics: completedMetrics };
  const result = { inputBytes: Buffer.byteLength(JSON.stringify(snapshot)), mock: { latencyMs, varied: !!process.env.SYNC_BENCH_VARIED, bytesPerSecond: 5 * 1024 * 1024 }, first, delta };
  console.info('SYNC_BENCH', JSON.stringify(result));
  if (process.env.SYNC_BENCH_OUTPUT) writeFileSync(process.env.SYNC_BENCH_OUTPUT, JSON.stringify(result, null, 2));
}, 1800000);
