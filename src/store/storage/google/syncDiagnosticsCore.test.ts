import { expect, it } from 'vitest';
import { createSyncDiagnostics, initialSyncDiagnostics, summarizeHistory, type SyncDiagnostics } from './diagnosticsCore';
import { createSyncMetrics } from './metricsCore';
import { createSyncProgress, initialSyncProgress } from './progressCore';

it('shares diagnostic reset, compaction history, and measured progress state without host I/O', async () => {
  const history = summarizeHistory({unaggregated:0,threshold:128,partBytes:1024,packs:[],cleanupTargets:0}, 1);
  let diagnostics: SyncDiagnostics = {...initialSyncDiagnostics(), history, lastCompaction:{status:'completed',at:1}};
  const collector = createSyncDiagnostics({get:()=>diagnostics,set:value=>{diagnostics=value;}}, () => 2);
  collector.start();
  expect(diagnostics).toMatchObject({active:true,result:'running',history,lastCompaction:{at:1},compaction:{status:'notChecked'}});
  collector.compaction({status:'completed',sourceFiles:3,newFiles:1});
  expect(diagnostics.lastCompaction).toMatchObject({at:2,sourceFiles:3});

  let progress = initialSyncProgress();
  const metrics = createSyncMetrics();
  const driver = createSyncProgress({get:()=>progress,set:value=>{progress=value;}}, {
    startDiagnostics:collector.start, finishDiagnostics:collector.finish, resetMetrics:metrics.reset, getMetrics:metrics.get,
    recordTransfer:collector.transfer, now:()=>10,
  });
  await driver.withSyncProgress(async () => { driver.syncPhase('uploading',1); driver.completedFile(4); });
  expect(progress).toMatchObject({active:false,overallProgress:1,completedBytes:4});
});
