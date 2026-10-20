import type { SyncMetrics } from './metricsCore';

export type TransferPurpose = 'normal' | 'pack-index' | 'pack' | 'compaction' | 'verification';
export type TransferBytes = { uploaded: number; downloaded: number; files: number };
export type CompactionStatus = 'notChecked' | 'skipped' | 'running' | 'completed' | 'interrupted';
export type CompactionReason = 'belowThreshold' | 'liveBelowThreshold' | 'new' | 'resume';
export type Compaction = { status: CompactionStatus; reason?: CompactionReason; sourceFiles?: number; newFiles?: number };
export type HistoryObservation = {
  unaggregated: number;
  threshold: number;
  partBytes: number;
  packs: { bytes: number; parts: number }[];
  cleanupTargets: number;
};
export type HistorySummary = ReturnType<typeof summarizeHistory>;
export type SyncDiagnostics = {
  observed: boolean;
  active: boolean;
  result: 'running' | 'completed' | 'failed';
  elapsedMs: number;
  transfers: Record<TransferPurpose, TransferBytes>;
  packSkipped: number;
  packRead: number;
  metrics: SyncMetrics;
  compaction: Compaction;
  compactionsCompleted: number;
  lastCompaction?: Compaction & { at: number };
  history?: HistorySummary;
};
type Store = { get: () => SyncDiagnostics; set: (value: SyncDiagnostics) => void };

export const emptyTransfers = (): Record<TransferPurpose, TransferBytes> => Object.fromEntries(
  ['normal', 'pack-index', 'pack', 'compaction', 'verification'].map(name => [name, { uploaded: 0, downloaded: 0, files: 0 }])
) as Record<TransferPurpose, TransferBytes>;
export const initialSyncDiagnostics = (): SyncDiagnostics => ({
  observed: false,
  active: false,
  result: 'completed',
  elapsedMs: 0,
  transfers: emptyTransfers(),
  packSkipped: 0,
  packRead: 0,
  metrics: {},
  compaction: { status: 'notChecked' },
  compactionsCompleted: 0,
});
export function summarizeHistory(value: HistoryObservation, observedAt = Date.now()) {
  const bytes = value.packs.reduce((sum, pack) => sum + pack.bytes, 0);
  const payloadFiles = value.packs.reduce((sum, pack) => sum + pack.parts, 0);
  const referenceFiles = bytes ? Math.ceil(bytes / value.partBytes) : 0;
  return {
    unaggregated: value.unaggregated,
    threshold: value.threshold,
    overThreshold: Math.max(0, value.unaggregated - (value.threshold - 1)),
    packCount: value.packs.length,
    smallPacks: value.packs.filter(pack => pack.bytes < 1024 * 1024).length,
    payloadFiles,
    referenceFiles,
    excessPayloadFiles: Math.max(0, payloadFiles - referenceFiles),
    cleanupTargets: value.cleanupTargets,
    observedAt,
  };
}
export function createSyncDiagnostics(store: Store, now: () => number = Date.now) {
  return {
    start: () => {
      const state = store.get();
      store.set({
        ...state,
        observed: true,
        active: true,
        result: 'running',
        elapsedMs: 0,
        transfers: emptyTransfers(),
        packSkipped: 0,
        packRead: 0,
        metrics: {},
        compaction: { status: 'notChecked' },
        compactionsCompleted: 0,
      });
    },
    finish: (result: 'completed'|'failed', elapsedMs: number, metrics: SyncMetrics) => {
      const state = store.get();
      store.set({...state, active:false, result, elapsedMs, metrics,
        compaction: result === 'failed' && state.compaction.status === 'running' ? {...state.compaction,status:'interrupted'} : state.compaction});
    },
    transfer: (direction: 'upload'|'download', bytes: number, purpose: TransferPurpose) => {
      const state = store.get(), value = state.transfers[purpose], field = direction === 'upload' ? 'uploaded' : 'downloaded';
      store.set({...state, transfers:{...state.transfers,[purpose]:{...value,files:value.files + 1,[field]:value[field] + bytes}}});
    },
    packAccess: (skipped: boolean) => { const state = store.get(); store.set({...state,[skipped ? 'packSkipped' : 'packRead']:state[skipped ? 'packSkipped' : 'packRead'] + 1}); },
    history: (value: HistoryObservation) => { const state = store.get(); store.set({...state,history:summarizeHistory(value,now())}); },
    compaction: (value: Compaction) => {
      const state = store.get(), completed = value.status === 'completed';
      store.set({...state,compaction:value,compactionsCompleted:state.compactionsCompleted + (completed ? 1 : 0),...(completed ? {lastCompaction:{...value,at:now()}} : {})});
    },
  };
}
