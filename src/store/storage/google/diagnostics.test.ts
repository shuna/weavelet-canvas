import { afterEach, expect, it, vi } from 'vitest';
import { beginTransfer, useGoogleSyncProgress, withSyncProgress } from './progress';
import { recordMetric } from './metrics';
import { reportCompaction, reportSyncHistory, recordPackAccess, summarizeHistory, useGoogleSyncDiagnostics } from './diagnostics';

afterEach(() => vi.restoreAllMocks());

it('keeps payload categories, throughput and completed compaction visible after the operation ends', async () => {
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  await withSyncProgress(async () => {
    const normal = beginTransfer('upload');
    now = 200; normal(512);
    reportCompaction({ status: 'running', reason: 'new', sourceFiles: 129, newFiles: 2 });
    const pack = beginTransfer('upload', 'compaction');
    now = 1200; pack(4 * 1024 * 1024);
    const verification = beginTransfer('download', 'verification');
    now = 2200; verification(4 * 1024 * 1024);
    const index = beginTransfer('download', 'pack-index');
    now = 2300; index(1024);
    recordPackAccess(true);
    reportCompaction({ status: 'completed', sourceFiles: 129, newFiles: 2 });
    const processing = now;
    now += 50; recordMetric('compress', processing);
    reportSyncHistory({ unaggregated: 0, threshold: 128, partBytes: 4 * 1024 * 1024,
      packs: [{ bytes: 4 * 1024 * 1024, parts: 1 }], cleanupTargets: 0 });
  });
  const diagnostics = useGoogleSyncDiagnostics.getState();
  expect(diagnostics).toMatchObject({ active: false, result: 'completed', elapsedMs: 2250, packSkipped: 1,
    compactionsCompleted: 1, compaction: { status: 'completed' }, lastCompaction: { sourceFiles: 129, newFiles: 2 },
    metrics: { compress: { calls: 1, ms: 50 } }, transfers: {
      normal: { uploaded: 512, downloaded: 0, files: 1 },
      compaction: { uploaded: 4 * 1024 * 1024, downloaded: 0, files: 1 },
      verification: { uploaded: 0, downloaded: 4 * 1024 * 1024, files: 1 },
      'pack-index': { uploaded: 0, downloaded: 1024, files: 1 },
    } });
  expect(useGoogleSyncProgress.getState()).toMatchObject({ uploadMs: 1100, downloadMs: 1100 });
  await withSyncProgress(async () => reportCompaction({ status: 'skipped', reason: 'belowThreshold' }));
  expect(useGoogleSyncDiagnostics.getState()).toMatchObject({ compactionsCompleted: 0,
    compaction: { status: 'skipped' }, lastCompaction: { sourceFiles: 129 }, transfers: { compaction: { uploaded: 0 } } });
});

it('reports an interrupted compaction and excludes failed and late transfers', async () => {
  let late!: (bytes: number) => void;
  await expect(withSyncProgress(async () => {
    reportCompaction({ status: 'running', reason: 'resume' });
    late = beginTransfer('upload', 'compaction');
    throw new Error('private error text must not be stored');
  })).rejects.toThrow('private error');
  expect(useGoogleSyncDiagnostics.getState()).toMatchObject({ active: false, result: 'failed',
    compaction: { status: 'interrupted' }, transfers: { compaction: { uploaded: 0 } } });
  expect(JSON.stringify(useGoogleSyncDiagnostics.getState())).not.toContain('private error');
  await withSyncProgress(async () => {
    late(999);
    expect(useGoogleSyncDiagnostics.getState().transfers.compaction.uploaded).toBe(0);
  });
});

it('distinguishes the commit threshold from the compressed-payload reference and cleanup checks', () => {
  expect(summarizeHistory({ unaggregated: 127, threshold: 128, partBytes: 1024,
    packs: [{ bytes: 400, parts: 1 }, { bytes: 600, parts: 1 }], cleanupTargets: 3 })).toMatchObject({
    overThreshold: 0, payloadFiles: 2, referenceFiles: 1, excessPayloadFiles: 1, cleanupTargets: 3,
  });
  expect(summarizeHistory({ unaggregated: 128, threshold: 128, partBytes: 1024,
    packs: [{ bytes: 1025, parts: 2 }], cleanupTargets: 0 })).toMatchObject({
    overThreshold: 1, payloadFiles: 2, referenceFiles: 2, excessPayloadFiles: 0,
  });
  expect(summarizeHistory({ unaggregated: 0, threshold: 128, partBytes: 1024, packs: [], cleanupTargets: 0 }))
    .toMatchObject({ referenceFiles: 0, excessPayloadFiles: 0 });
});
