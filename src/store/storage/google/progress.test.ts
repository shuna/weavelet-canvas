import { afterEach, expect, it, vi } from 'vitest';
import { beginTransfer, syncStage, phaseProgress, syncPhase, completedFile, useGoogleSyncProgress, withSyncProgress } from './progress';
import { DriveTransport } from './transport';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reports payload bytes and time only for completed transfers and stops on errors', async () => {
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', vi.fn()
    .mockImplementationOnce(async () => { now = 2000; return new Response('ok'); })
    .mockImplementationOnce(async () => { now = 2500; return new Response(new Uint8Array(512)); })
    .mockResolvedValueOnce(new Response('', { status: 503 })));
  const drive = new DriveTransport(() => 'token');
  await expect(withSyncProgress(async () => {
    syncPhase('uploading', 2, 2048);
    await drive.put('part', 'dataset', 'part', new Uint8Array(1024));
    completedFile(1024);
    await drive.read('key');
    expect(useGoogleSyncProgress.getState()).toMatchObject({
      active: true, totalBytes: 2048, completedBytes: 1024, completedFiles: 1,
      uploadedBytes: 1024, uploadMs: 1000, downloadedBytes: 512, downloadMs: 500, downloadedFiles: 1,
    });
    await drive.put('commit', 'dataset', 'commit', new Uint8Array(1024));
  })).rejects.toThrow('503');
  expect(useGoogleSyncProgress.getState()).toMatchObject({ active: false, completedFiles: 1, uploadedBytes: 1024 });
  await withSyncProgress(async () => {
    expect(useGoogleSyncProgress.getState()).toMatchObject({ uploadedBytes: 0, completedFiles: 0, totalBytes: undefined });
  });
});

it('does not count late callbacks in a subsequent sync or present unknown totals as percentages', async () => {
  let late!: (bytes: number) => void;
  await withSyncProgress(async () => { late = beginTransfer('download'); });
  await withSyncProgress(async () => {
    syncPhase('checking');
    late(100);
    expect(useGoogleSyncProgress.getState()).toMatchObject({ totalBytes: undefined, totalFiles: undefined, downloadedBytes: 0 });
  });
});

it('counts overlapping successful transfers once for aggregate throughput', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  await withSyncProgress(async () => {
    const first = beginTransfer('upload');
    now = 100;
    const second = beginTransfer('upload');
    now = 500; second(200);
    now = 1000; first(300);
    expect(useGoogleSyncProgress.getState()).toMatchObject({ uploadedBytes: 500, uploadMs: 1000 });
  });
});

it('combines stage counts and file counts while reserving later verification and saving', async () => {
  await withSyncProgress(async () => {
    await syncStage(0, 3, async () => {
      await syncStage(0, 2, async () => {
        syncPhase('uploading', 4);
        completedFile(10);
        expect(phaseProgress(useGoogleSyncProgress.getState())).toBe(0.25);
        expect(useGoogleSyncProgress.getState().overallProgress).toBeCloseTo(1 / 24);
        for (let i = 0; i < 3; i++) completedFile(10);
        expect(useGoogleSyncProgress.getState().overallProgress).toBeCloseTo(1 / 6);
      });
      await syncStage(1, 2, async () => {
        syncPhase('verifying');
        expect(phaseProgress(useGoogleSyncProgress.getState())).toBeUndefined();
        expect(useGoogleSyncProgress.getState().overallProgress).toBeCloseTo(1 / 6);
      });
    });
    expect(useGoogleSyncProgress.getState().overallProgress).toBeCloseTo(1 / 3);
    await syncStage(1, 3, async () => {
      // Nested progress wrappers must retain the operation and its stage range.
      await withSyncProgress(async () => {
        syncPhase('downloading', 2);
        completedFile(10);
        expect(useGoogleSyncProgress.getState().overallProgress).toBeCloseTo(0.5);
      });
      expect(useGoogleSyncProgress.getState().active).toBe(true);
    });
    await syncStage(2, 3, async () => {
      syncPhase('saving', 1);
      completedFile(10);
      expect(useGoogleSyncProgress.getState().overallProgress).toBeLessThan(1);
    });
    expect(useGoogleSyncProgress.getState().overallProgress).toBeLessThan(1);
  });
  expect(useGoogleSyncProgress.getState()).toMatchObject({ active: false, overallProgress: 1 });
  await expect(withSyncProgress(() => syncStage(0, 2, async () => {
    syncPhase('uploading', 1);
    completedFile(10);
    throw new Error('failed');
  }))).rejects.toThrow('failed');
  expect(useGoogleSyncProgress.getState()).toMatchObject({ active: false, overallProgress: 0.5 });
});
