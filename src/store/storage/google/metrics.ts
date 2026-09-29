export type SyncMetric = 'ids' | 'records' | 'serialize' | 'compress' | 'encrypt' | 'decrypt' | 'drive' | 'cache';
type Metric = { calls: number; ms: number; inputBytes: number; outputBytes: number };
let metrics: Partial<Record<SyncMetric, Metric>> = {};
export const resetSyncMetrics = () => { metrics = {}; };
export const getSyncMetrics = () => structuredClone(metrics);
export function recordMetric(name: SyncMetric, started: number, inputBytes = 0, outputBytes = 0) {
  const entry = metrics[name] ??= { calls: 0, ms: 0, inputBytes: 0, outputBytes: 0 };
  entry.calls++; entry.ms += performance.now() - started;
  entry.inputBytes += inputBytes; entry.outputBytes += outputBytes;
}
export async function measure<T>(name: SyncMetric, work: () => Promise<T>, inputBytes = 0): Promise<T> {
  const started = performance.now();
  try { return await work(); }
  finally { recordMetric(name, started, inputBytes); }
}

export function mergeSyncMetrics(values: ReturnType<typeof getSyncMetrics>) {
  for (const name of Object.keys(values) as SyncMetric[]) {
    const value = values[name]!;
    const entry = metrics[name] ??= { calls: 0, ms: 0, inputBytes: 0, outputBytes: 0 };
    for (const field of ['calls', 'ms', 'inputBytes', 'outputBytes'] as const) entry[field] += value[field];
  }
}
