// Run with SYNC_BENCH=1 vitest run src/store/storage/google/benchmark.test.ts --testTimeout=1800000.
// Synthetic data only. The optional SYNC_BENCH_BASE is an instrumented pre-change module directory.
import { it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { EncryptedDriveSync } from './sync';
import { resetSyncMetrics, getSyncMetrics } from './metrics';
import type { DriveTransport } from './transport';
import type { Snapshot } from './records';

it.skipIf(!process.env.SYNC_BENCH)('measures a 32 MiB initial snapshot and one title edit', async () => {
  const base = process.env.SYNC_BENCH_BASE;
  const Engine = base ? (await import(`${base}/sync.ts`)).EncryptedDriveSync : EncryptedDriveSync;
  const metrics = base ? await import(`${base}/metrics.ts`) : { resetSyncMetrics, getSyncMetrics };
  (globalThis as any).indexedDB = new IDBFactory();
  let next = 0, requests = 0, bytes = 0, inflight = 0, peak = 0, uploadStart = 0, uploadEnd = 0;
  const files = new Map<string, { data: Uint8Array; metadata: any }>();
  const events: any[] = [];
  const wait = async (size = 0) => { requests++; await new Promise(r => setTimeout(r, 20 + size / (5 * 1024 * 1024) * 1000)); };
  const drive = {
    async id() { await wait(); return `f${++next}`; },
    async ids(count: number) { await wait(); return Array.from({ length: count }, () => `f${++next}`); },
    async folder(id: string, headerId: string) { await wait(); return { id, mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId } }; },
    async put(id: string, dataset: string, kind: string, data: Uint8Array) {
      if (kind !== 'key' && !uploadStart) uploadStart = performance.now();
      inflight++; peak = Math.max(peak, inflight);
      await wait(data.length); inflight--; bytes += data.length; uploadEnd = performance.now();
      if (!files.has(id)) {
        const metadata = { id, appProperties: { dataset, kind } };
        files.set(id, { data: data.slice(), metadata }); events.push({ fileId: id, file: metadata });
      }
    },
    async read(id: string) { await wait(); return files.get(id)!.data.slice(); },
    async startToken() { await wait(); return String(events.length); },
    async commits() { await wait(); return [...files.values()].filter(f => f.metadata.appProperties.kind === 'commit').map(f => f.metadata.id); },
    async changes(token: string) { await wait(); return { token: String(events.length), changes: events.slice(Number(token)) }; },
  } as unknown as DriveTransport;
  const image = 'data:image/png;base64,' + randomBytes(1536 * 1024).toString('base64');
  const text = 'Synthetic conversation for synchronization benchmarking. '.repeat(Math.ceil(30 * 1024 * 1024 / 55)).slice(0, 30 * 1024 * 1024);
  const snapshot = { version: 18, state: { chats: [{ id: 'bench', title: 'before', messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] }] }], contentStore: {}, theme: 'dark' } } as Snapshot;
  metrics.resetSyncMetrics();
  const started = performance.now();
  const { session } = await Engine.create(drive, 'synthetic benchmark password', { partBytes: Number(process.env.SYNC_BENCH_PART ?? 262144), concurrency: Number(process.env.SYNC_BENCH_CONCURRENCY ?? 1) });
  await session.push(snapshot, true);
  const first = { ms: performance.now() - started, requests, bytes, peak, uploadMs: uploadEnd - uploadStart, metrics: metrics.getSyncMetrics() };
  requests = bytes = peak = 0; metrics.resetSyncMetrics();
  snapshot.state.chats![0].title = 'after';
  const edited = performance.now();
  await session.push(snapshot);
  const delta = { ms: performance.now() - edited, requests, bytes, metrics: metrics.getSyncMetrics() };
  const result = { inputBytes: Buffer.byteLength(JSON.stringify(snapshot)), mock: { latencyMs: 20, bytesPerSecond: 5 * 1024 * 1024 }, first, delta };
  console.info('SYNC_BENCH', JSON.stringify(result));
  if (process.env.SYNC_BENCH_OUTPUT) writeFileSync(process.env.SYNC_BENCH_OUTPUT, JSON.stringify(result, null, 2));
}, 1800000);
