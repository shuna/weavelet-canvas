import { getSyncMetrics, resetSyncMetrics } from './metrics';
import { create } from 'zustand';

export type SyncPhase = 'preparing' | 'key' | 'folder' | 'checking' | 'downloading' | 'encrypting' | 'uploading' | 'saving' | 'verifying';
const initial = () => ({
  active: false, phase: 'preparing' as SyncPhase,
  completedFiles: 0, totalFiles: undefined as number | undefined,
  completedBytes: 0, totalBytes: undefined as number | undefined,
  uploadedBytes: 0, downloadedBytes: 0, downloadedFiles: 0,
  uploadMs: 0, downloadMs: 0,
});
// Progress is transient UI state; never persist it alongside chat data or credentials.
export const useGoogleSyncProgress = create(initial);
let operation = 0;
let intervals: Record<'upload' | 'download', [number, number][]> = { upload: [], download: [] };
export async function withSyncProgress<T>(work: () => Promise<T>): Promise<T> {
  const current = ++operation;
  resetSyncMetrics();
  intervals = { upload: [], download: [] };
  useGoogleSyncProgress.setState({ ...initial(), active: true });
  try { return await work(); }
  finally {
    if (current === operation) {
      useGoogleSyncProgress.setState({ active: false });
      console.info('[Google sync metrics]', getSyncMetrics());
    }
  }
}
export function syncPhase(phase: SyncPhase, totalFiles?: number, totalBytes?: number, completedFiles = 0) {
  if (!useGoogleSyncProgress.getState().active) return;
  useGoogleSyncProgress.setState({ phase, totalFiles, totalBytes, completedFiles, completedBytes: 0 });
}
export function completedFile(bytes: number) {
  if (!useGoogleSyncProgress.getState().active) return;
  useGoogleSyncProgress.setState(s => ({ completedFiles: s.completedFiles + 1, completedBytes: s.completedBytes + bytes }));
}
export function beginTransfer(direction: 'upload' | 'download') {
  const current = operation;
  const started = performance.now();
  return (bytes: number) => {
    if (current !== operation || !useGoogleSyncProgress.getState().active) return;
    const ranges = intervals[direction];
    ranges.push([started, performance.now()]);
    ranges.sort((a, b) => a[0] - b[0]);
    let elapsed = 0, end = -Infinity;
    for (const [from, to] of ranges) { elapsed += Math.max(0, to - Math.max(from, end)); end = Math.max(end, to); }
    elapsed = Math.max(1, elapsed);
    useGoogleSyncProgress.setState(s => direction === 'upload'
      ? { uploadedBytes: s.uploadedBytes + bytes, uploadMs: elapsed }
      : { downloadedBytes: s.downloadedBytes + bytes, downloadMs: elapsed, downloadedFiles: s.downloadedFiles + 1 });
  };
}
