export type SyncMetric = 'ids' | 'records' | 'serialize' | 'compress' | 'encrypt' | 'decrypt' | 'drive' | 'cache';
export type SyncMetricValue = {
  calls: number;
  ms: number;
  inputBytes: number;
  outputBytes: number;
};
export type SyncMetrics = Partial<Record<SyncMetric, SyncMetricValue>>;

export function createSyncMetrics() {
  let metrics: SyncMetrics = {};
  const recordMetric = (
    name: SyncMetric,
    started: number,
    inputBytes = 0,
    outputBytes = 0,
    now = performance.now(),
  ) => {
    const entry = metrics[name] ??= { calls: 0, ms: 0, inputBytes: 0, outputBytes: 0 };
    entry.calls++;
    entry.ms += now - started;
    entry.inputBytes += inputBytes;
    entry.outputBytes += outputBytes;
  };
  return {
    reset: () => { metrics = {}; },
    get: () => structuredClone(metrics),
    recordMetric,
    measure: async <T>(name: SyncMetric, work: () => Promise<T>, inputBytes = 0) => {
      const started = performance.now();
      try {
        return await work();
      } finally {
        recordMetric(name, started, inputBytes);
      }
    },
    merge: (values: SyncMetrics) => {
      for (const name of Object.keys(values) as SyncMetric[]) {
        const value = values[name]!;
        const entry = metrics[name] ??= { calls: 0, ms: 0, inputBytes: 0, outputBytes: 0 };
        for (const field of ['calls', 'ms', 'inputBytes', 'outputBytes'] as const) {
          entry[field] += value[field];
        }
      }
    },
  };
}
