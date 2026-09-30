import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot, type Snapshot, type Records } from './records';
import { mergeSyncMetrics } from './metrics';

// Keep whole-snapshot CPU work off the UI thread. Only environments without Workers
// (including unit tests) use the same implementations directly.
function processAsync<T>(operation: string, value: unknown, fallback: () => T | Promise<T>): Promise<T> {
  if (typeof Worker === 'undefined') return Promise.resolve().then(fallback);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      mergeSyncMetrics(data.metrics);
      if (data.error) reject(new Error(data.error));
      else resolve(data.value);
    };
    worker.onerror = worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Unable to process sync data in a worker.'));
    };
    // Do not transfer input buffers: the immutable encoded commit remains available
    // to the durable outbox/cache and must survive a worker failure unchanged.
    try { worker.postMessage({ operation, value }); }
    catch (error) { worker.terminate(); reject(error); }
  });
}

export const encodeAsync = (value: unknown) => processAsync('encode', value, () => encode(value));
export const decodeAsync = <T>(value: Uint8Array) => processAsync('decode', value, () => decode<T>(value));
export const toRecordsAsync = (value: Snapshot) => processAsync('toRecords', value, () => toRecords(value));
export const fromRecordsAsync = (value: Records) => processAsync('fromRecords', value, () => fromRecords(value));
export const hashRecordsAsync = (value: Records) => processAsync('hashRecords', value, () => hashRecords(value));
export const sameSnapshotAsync = (a: Snapshot, b: Snapshot) => processAsync('sameSnapshot', [a, b], () => sameSnapshot([a, b]));
