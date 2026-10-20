import type { TransferPurpose } from './diagnosticsCore';
import type { SyncMetrics } from './metricsCore';
export type SyncPhase = 'preparing' | 'key' | 'folder' | 'checking' | 'downloading' | 'encrypting' | 'uploading' | 'saving' | 'verifying' | 'history';
export type HistoryProgress = { step: string; completed: number; total?: number };
export type SyncProgress = {
  overallProgress: number;
  active: boolean;
  phase: SyncPhase;
  historyProgress?: HistoryProgress;
  completedFiles: number;
  totalFiles?: number;
  completedBytes: number;
  totalBytes?: number;
  uploadedBytes: number;
  downloadedBytes: number;
  downloadedFiles: number;
  uploadMs: number;
  downloadMs: number;
};
export const initialSyncProgress = (): SyncProgress => ({
  overallProgress: 0,
  active: false,
  phase: 'preparing',
  historyProgress: undefined,
  completedFiles: 0,
  totalFiles: undefined,
  completedBytes: 0,
  totalBytes: undefined,
  uploadedBytes: 0,
  downloadedBytes: 0,
  downloadedFiles: 0,
  uploadMs: 0,
  downloadMs: 0,
});
type Store = { get: () => SyncProgress; set: (value: SyncProgress) => void };
type Dependencies = { startDiagnostics: () => void; finishDiagnostics: (result:'completed'|'failed',elapsed:number,metrics:SyncMetrics) => void; resetMetrics: () => void; getMetrics: () => SyncMetrics; recordTransfer:(direction:'upload'|'download',bytes:number,purpose:TransferPurpose)=>void; now?:()=>number };
export function createSyncProgress(store: Store, dependencies: Dependencies) {
  let operation = 0;
  let stageRange: [number, number] = [0, 1];
  let intervals: Record<'upload'|'download', [number, number][]> = { upload: [], download: [] };
  const now = dependencies.now ?? (() => performance.now());
  const phaseProgress = (progress: SyncProgress) => progress.phase === 'history'
    ? (progress.historyProgress?.total ? Math.min(1,progress.historyProgress.completed / progress.historyProgress.total) : undefined)
    : progress.totalFiles !== undefined && progress.totalFiles > 0 ? Math.min(1,progress.completedFiles / progress.totalFiles) : undefined;
  const advanceOverall = (value: number) => {
    const state = store.get();
    store.set({...state, overallProgress: Math.max(state.overallProgress, Math.min(0.99, value))});
  };
  const advanceFiles = () => {
    const fraction = phaseProgress(store.get());
    if (fraction !== undefined) advanceOverall(stageRange[0] + (stageRange[1] - stageRange[0]) * fraction);
  };
  return {
    phaseProgress,
    withSyncProgress: async <T>(work: () => Promise<T>): Promise<T> => {
      if (store.get().active) return work();
      const current = ++operation, started = now();
      let result: 'completed'|'failed' = 'failed';
      dependencies.startDiagnostics(); dependencies.resetMetrics(); intervals = {upload:[],download:[]}; stageRange = [0,1]; store.set({...initialSyncProgress(),active:true});
      try {
        const value = await work(); result = 'completed';
        if (current === operation) store.set({...store.get(),overallProgress:1});
        return value;
      } finally {
        if (current === operation) { store.set({...store.get(),active:false}); dependencies.finishDiagnostics(result,now()-started,dependencies.getMetrics()); }
      }
    },
    syncStage: async <T>(index:number,total:number,work:()=>Promise<T>):Promise<T> => {
      if(!store.get().active) return work(); const current=operation,parent=stageRange,span=(parent[1]-parent[0])/total; stageRange=[parent[0]+index*span,parent[0]+(index+1)*span]; const end=stageRange[1];
      store.set({...store.get(),totalFiles:undefined,totalBytes:undefined,completedFiles:0,completedBytes:0,historyProgress:undefined}); advanceOverall(stageRange[0]);
      try { const result=await work(); if(current===operation) advanceOverall(end); return result; } finally { if(current===operation) stageRange=parent; }
    },
    syncPhase: (phase:SyncPhase,totalFiles?:number,totalBytes?:number,completedFiles=0) => { if(!store.get().active)return; store.set({...store.get(),phase,totalFiles,totalBytes,completedFiles,completedBytes:0,historyProgress:undefined}); advanceFiles(); },
    syncHistoryProgress: (historyProgress:HistoryProgress) => { if(!store.get().active)return; store.set({...store.get(),phase:'history',historyProgress,totalFiles:undefined,totalBytes:undefined,completedFiles:0,completedBytes:0}); },
    completedFile: (bytes:number) => { if(!store.get().active)return; const state=store.get(); store.set({...state,completedFiles:state.completedFiles+1,completedBytes:state.completedBytes+bytes}); advanceFiles(); },
    beginTransfer: (direction:'upload'|'download',purpose:TransferPurpose='normal') => { const current=operation,started=now(); return (bytes:number) => { if(current!==operation||!store.get().active)return; dependencies.recordTransfer(direction,bytes,purpose); const ranges=intervals[direction]; ranges.push([started,now()]); ranges.sort((a,b)=>a[0]-b[0]); let elapsed=0,end=-Infinity; for(const [from,to] of ranges){elapsed+=Math.max(0,to-Math.max(from,end));end=Math.max(end,to);} elapsed=Math.max(1,elapsed); const state=store.get(); store.set(direction==='upload'?{...state,uploadedBytes:state.uploadedBytes+bytes,uploadMs:elapsed}:{...state,downloadedBytes:state.downloadedBytes+bytes,downloadMs:elapsed,downloadedFiles:state.downloadedFiles+1}); }; },
  };
}
