import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot } from './records';
import { getSyncMetrics } from './metrics';

const operations = { encode, decode, toRecords, fromRecords, hashRecords, sameSnapshot };
self.onmessage = async ({ data }: MessageEvent<{ operation: keyof typeof operations; value: any }>) => {
  try {
    const value = await operations[data.operation](data.value);
    self.postMessage({ value, metrics: getSyncMetrics() }, {
      transfer: value instanceof Uint8Array ? [value.buffer] : [],
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to process sync data.', metrics: getSyncMetrics() });
  }
};
