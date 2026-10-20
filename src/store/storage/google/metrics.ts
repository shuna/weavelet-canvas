import { createSyncMetrics, type SyncMetric, type SyncMetrics } from './metricsCore';
export type { SyncMetric } from './metricsCore';
const metrics = createSyncMetrics();
export const resetSyncMetrics = metrics.reset;
export const getSyncMetrics = metrics.get;
export const recordMetric = metrics.recordMetric;
export const measure = metrics.measure;
export const mergeSyncMetrics = (values: SyncMetrics) => metrics.merge(values);
