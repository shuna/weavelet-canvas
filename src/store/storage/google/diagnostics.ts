import { create } from 'zustand';
import type { getSyncMetrics } from './metrics';

export type TransferPurpose = 'normal' | 'pack-index' | 'pack' | 'compaction' | 'verification';
type Bytes = { uploaded: number; downloaded: number; files: number };
type CompactionStatus = 'notChecked' | 'skipped' | 'running' | 'completed' | 'interrupted';
type CompactionReason = 'belowThreshold' | 'liveBelowThreshold' | 'new' | 'resume';
interface Compaction { status: CompactionStatus; reason?: CompactionReason; sourceFiles?: number; newFiles?: number }
export interface HistoryObservation {
  unaggregated: number;
  threshold: number;
  partBytes: number;
  packs: { bytes: number; parts: number }[];
  cleanupTargets: number;
}
export function summarizeHistory(value: HistoryObservation) {
  const bytes = value.packs.reduce((sum, pack) => sum + pack.bytes, 0);
  const payloadFiles = value.packs.reduce((sum, pack) => sum + pack.parts, 0);
  const referenceFiles = bytes ? Math.ceil(bytes / value.partBytes) : 0;
  return { unaggregated: value.unaggregated, threshold: value.threshold,
    overThreshold: Math.max(0, value.unaggregated - (value.threshold - 1)),
    packCount: value.packs.length, smallPacks: value.packs.filter(pack => pack.bytes < 1024 * 1024).length,
    payloadFiles, referenceFiles, excessPayloadFiles: Math.max(0, payloadFiles - referenceFiles),
    cleanupTargets: value.cleanupTargets, observedAt: Date.now() };
}
const emptyTransfers = (): Record<TransferPurpose, Bytes> => Object.fromEntries(
  ['normal', 'pack-index', 'pack', 'compaction', 'verification'].map(name => [name, { uploaded: 0, downloaded: 0, files: 0 }])
) as Record<TransferPurpose, Bytes>;
interface Diagnostics {
  observed: boolean;
  active: boolean;
  result: 'running' | 'completed' | 'failed';
  elapsedMs: number;
  transfers: Record<TransferPurpose, Bytes>;
  packSkipped: number;
  packRead: number;
  metrics: ReturnType<typeof getSyncMetrics>;
  compaction: Compaction;
  compactionsCompleted: number;
  lastCompaction?: Compaction & { at: number };
  history?: ReturnType<typeof summarizeHistory>;
}
// Numeric, transient diagnostics only; no chat content, file IDs, tokens or passphrases.
export const useGoogleSyncDiagnostics = create<Diagnostics>(() => ({
  observed: false, active: false, result: 'completed', elapsedMs: 0,
  transfers: emptyTransfers(), packSkipped: 0, packRead: 0, metrics: {}, compaction: { status: 'notChecked' }, compactionsCompleted: 0,
}));
export function startSyncDiagnostics() {
  useGoogleSyncDiagnostics.setState({ observed: true, active: true, result: 'running', elapsedMs: 0,
    transfers: emptyTransfers(), packSkipped: 0, packRead: 0, metrics: {}, compaction: { status: 'notChecked' }, compactionsCompleted: 0 });
}
export function finishSyncDiagnostics(result: 'completed' | 'failed', elapsedMs: number, metrics: ReturnType<typeof getSyncMetrics>) {
  useGoogleSyncDiagnostics.setState(state => ({ active: false, result, elapsedMs, metrics,
    compaction: result === 'failed' && state.compaction.status === 'running'
      ? { ...state.compaction, status: 'interrupted' } : state.compaction }));
}
export function recordSyncTransfer(direction: 'upload' | 'download', bytes: number, purpose: TransferPurpose) {
  useGoogleSyncDiagnostics.setState(state => ({ transfers: { ...state.transfers, [purpose]: {
    ...state.transfers[purpose], files: state.transfers[purpose].files + 1,
    [direction === 'upload' ? 'uploaded' : 'downloaded']: state.transfers[purpose][direction === 'upload' ? 'uploaded' : 'downloaded'] + bytes,
  } } }));
}
export function recordPackAccess(skipped: boolean) {
  useGoogleSyncDiagnostics.setState(state => skipped ? { packSkipped: state.packSkipped + 1 } : { packRead: state.packRead + 1 });
}
export function reportSyncHistory(value: HistoryObservation) {
  useGoogleSyncDiagnostics.setState({ history: summarizeHistory(value) });
}
export function reportCompaction(value: Compaction) {
  useGoogleSyncDiagnostics.setState(state => ({ compaction: value,
    compactionsCompleted: state.compactionsCompleted + (value.status === 'completed' ? 1 : 0),
    ...(value.status === 'completed' ? { lastCompaction: { ...value, at: Date.now() } } : {}) }));
}
