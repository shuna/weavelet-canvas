import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot } from './records';
import { getSyncMetrics } from './metrics';
import { replayHistory } from './replay';
import { decodeParts } from './decodeParts';
import { SyncConflictError } from './records';
import { prepareHydratedData } from '../../rehydrateData';
import { prepareSave } from '../prepareSave';

const operations = { encode, decode, toRecords, fromRecords, hashRecords, sameSnapshot, replayHistory, decodeParts, prepareHydratedData, prepareSave };
self.onmessage = async ({ data }: MessageEvent<{ operation: keyof typeof operations; value: any }>) => {
  try {
    const value = await operations[data.operation](data.value);
    self.postMessage({ value, metrics: getSyncMetrics() }, {
      transfer: value instanceof Uint8Array ? [value.buffer] :
        value && typeof value === 'object' && 'bytes' in value && value.bytes instanceof Uint8Array ? [value.bytes.buffer] : [],
    });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to process sync data.',
      conflictKeys: error instanceof SyncConflictError ? error.keys : undefined, metrics: getSyncMetrics() });
  }
};
