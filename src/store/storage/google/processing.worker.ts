import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot } from './records';
import { getSyncMetrics, resetSyncMetrics } from './metrics';
import { collectHistory, hashCommits, replayHistory } from './replay';
import { decodeParts } from './decodeParts';
import { SyncConflictError } from './records';
import { prepareHydratedData } from '../../rehydrateData';
import { prepareSave } from '../prepareSave';
import { encodeWire, decodeWire } from './wire';
import { encodeCache, decodeCache } from './cacheCodec';
import { encodeNativeWire, hashNativeCommits, decodeNativeParts } from './nativeWireCodec';

const operations = { encode, decode, encodeCache, decodeCache, encodeNative: encodeNativeWire, hashNativeCommits, decodeNativeParts, toRecords, fromRecords,
  fromRecordsWithContent: ({ records, previous }: { records: Parameters<typeof fromRecords>[0]; previous: Parameters<typeof fromRecords>[1] }) => fromRecords(records, previous),
  encodeWire: ({ value, full }: { value: Parameters<typeof encodeWire>[0]; full?: Uint8Array }) => encodeWire(value, full),
  decodeWireParts: async (parts: Uint8Array[]) => {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return { bytes, value: await decodeWire(bytes) };
  },
  hashRecords, hashCommits, sameSnapshot, replayHistory, collectHistory, decodeParts, prepareHydratedData, prepareSave };
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; operation: keyof typeof operations; value: any }>) => {
  queue = queue.then(async () => {
  resetSyncMetrics();
  try {
    const value = data.operation === 'replayHistory' || data.operation === 'collectHistory'
      ? await operations[data.operation](data.value, progress => self.postMessage({ id: data.id, progress }))
      : await operations[data.operation](data.value);
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
