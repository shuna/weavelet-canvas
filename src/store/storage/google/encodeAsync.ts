import { encode } from './crypto';
import { mergeSyncMetrics } from './metrics';

// Large initial compression takes seconds; keep the sync dialog and editor responsive.
export function encodeAsync(value: unknown): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return Promise.resolve(encode(value));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); mergeSyncMetrics(data.metrics); resolve(data.bytes); };
    worker.onerror = () => { worker.terminate(); reject(new Error('Unable to compress sync data.')); };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('Unable to receive compressed sync data.')); };
    worker.postMessage(value);
  });
}
