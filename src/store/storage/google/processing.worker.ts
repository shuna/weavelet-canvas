import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot } from './records';
import { getSyncMetrics, resetSyncMetrics } from './metrics';
import { hashCommits, replayHistory } from './replay';
import { decodeParts } from './decodeParts';
import { SyncConflictError } from './records';
import { prepareHydratedData } from '../../rehydrateData';
import { prepareSave } from '../prepareSave';

const operations = { encode, decode, toRecords, fromRecords, hashRecords, hashCommits, sameSnapshot, replayHistory, decodeParts, prepareHydratedData, prepareSave };
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; operation: keyof typeof operations; value: any }>) => {
  queue = queue.then(async () => {
  resetSyncMetrics();
  try {
    const value = await operations[data.operation](data.value);
    self.postMessage({ id: data.id, value, metrics: getSyncMetrics() }, {
      transfer: value instanceof Uint8Array ? [value.buffer] :
        value && typeof value === 'object' && 'bytes' in value && value.bytes instanceof Uint8Array ? [value.bytes.buffer] : [],
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Unable to process sync data.',
      conflictKeys: error instanceof SyncConflictError ? error.keys : undefined, metrics: getSyncMetrics() });
  }
  });
};
