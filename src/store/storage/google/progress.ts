import { startSyncDiagnostics, finishSyncDiagnostics, recordSyncTransfer, type TransferPurpose } from './diagnostics';
import { getSyncMetrics, resetSyncMetrics } from './metrics';
import { create } from 'zustand';

export type SyncPhase = 'preparing' | 'key' | 'folder' | 'checking' | 'downloading' | 'encrypting' | 'uploading' | 'saving' | 'verifying';
const initial = () => ({
  overallProgress: 0,
  active: false, phase: 'preparing' as SyncPhase,
  completedFiles: 0, totalFiles: undefined as number | undefined,
  completedBytes: 0, totalBytes: undefined as number | undefined,
  uploadedBytes: 0, downloadedBytes: 0, downloadedFiles: 0,
  uploadMs: 0, downloadMs: 0,
});
// Progress is transient UI state; never persist it alongside chat data or credentials.
export const useGoogleSyncProgress = create(initial);
let operation = 0;
let stageRange: [number, number] = [0, 1];
let intervals: Record<'upload' | 'download', [number, number][]> = { upload: [], download: [] };
export async function withSyncProgress<T>(work: () => Promise<T>): Promise<T> {
  if (useGoogleSyncProgress.getState().active) return work();
  const current = ++operation;
  const started = performance.now();
  let result: 'completed' | 'failed' = 'failed';
  startSyncDiagnostics();
  resetSyncMetrics();
  intervals = { upload: [], download: [] };
  stageRange = [0, 1];
  useGoogleSyncProgress.setState({ ...initial(), active: true });
  try {
    const value = await work();
    result = 'completed';
    if (current === operation) useGoogleSyncProgress.setState({ overallProgress: 1 });
    return value;
  }
  finally {
    if (current === operation) {
      useGoogleSyncProgress.setState({ active: false });
      finishSyncDiagnostics(result, performance.now() - started, getSyncMetrics());
      console.info('[Google sync metrics]', getSyncMetrics());
    }
  }
}
// Each workflow reserves equal ranges for its stages; nested workflows subdivide their range.
export async function syncStage<T>(index: number, total: number, work: () => Promise<T>): Promise<T> {
  if (!useGoogleSyncProgress.getState().active) return work();
  const current = operation;
  const parent = stageRange;
  const span = (parent[1] - parent[0]) / total;
  stageRange = [parent[0] + index * span, parent[0] + (index + 1) * span];
  const end = stageRange[1];
  useGoogleSyncProgress.setState({ totalFiles: undefined, totalBytes: undefined, completedFiles: 0, completedBytes: 0 });
  advanceOverall(stageRange[0]);
  try {
    const result = await work();
    if (current === operation) advanceOverall(end);
    return result;
  } finally {
    if (current === operation) stageRange = parent;
  }
}
function advanceOverall(value: number) {
  // Only successful completion of the entire operation publishes 100%.
  useGoogleSyncProgress.setState(s => ({ overallProgress: Math.max(s.overallProgress, Math.min(0.99, value)) }));
}
export function phaseProgress(progress: ReturnType<typeof useGoogleSyncProgress.getState>) {
  return progress.totalFiles !== undefined && progress.totalFiles > 0
    ? Math.min(1, progress.completedFiles / progress.totalFiles) : undefined;
}
function advanceFiles() {
  const fraction = phaseProgress(useGoogleSyncProgress.getState());
  if (fraction !== undefined) advanceOverall(stageRange[0] + (stageRange[1] - stageRange[0]) * fraction);
}
export function syncPhase(phase: SyncPhase, totalFiles?: number, totalBytes?: number, completedFiles = 0) {
  if (!useGoogleSyncProgress.getState().active) return;
  useGoogleSyncProgress.setState({ phase, totalFiles, totalBytes, completedFiles, completedBytes: 0 });
  advanceFiles();
}
export function completedFile(bytes: number) {
  if (!useGoogleSyncProgress.getState().active) return;
  useGoogleSyncProgress.setState(s => ({ completedFiles: s.completedFiles + 1, completedBytes: s.completedBytes + bytes }));
  advanceFiles();
}
export function beginTransfer(direction: 'upload' | 'download', purpose: TransferPurpose = 'normal') {
  const current = operation;
  const started = performance.now();
  return (bytes: number) => {
    if (current !== operation || !useGoogleSyncProgress.getState().active) return;
    recordSyncTransfer(direction, bytes, purpose);
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
