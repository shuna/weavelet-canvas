import { createSyncMetrics, type SyncMetric } from '../../../src/store/storage/google/metricsCore';
const metrics = createSyncMetrics();
export const resetSyncMetrics = metrics.reset;
export const getSyncMetrics = metrics.get;
export const recordMetric = (name: SyncMetric, started: number, inputBytes = 0, outputBytes = 0) => metrics.recordMetric(name,started,inputBytes,outputBytes);
export const measure = metrics.measure;
export const mergeSyncMetrics = metrics.merge;
