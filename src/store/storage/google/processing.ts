import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot, type Snapshot, type Records } from './records';
import { mergeSyncMetrics } from './metrics';
import { collectHistory, hashCommits, replayHistory, type Commit, type HistoryProgress } from './replay';
import { syncHistoryProgress } from './progress';
import { decodeParts } from './decodeParts';
import { SyncConflictError } from './records';
import { prepareHydratedData } from '../../rehydrateData';
import { prepareSave } from '../prepareSave';
import { encodeWire, decodeWire } from './wire';
import { encodeCache, decodeCache } from './cacheCodec';
import { encodeNativeWire, hashNativeCommits, decodeNativeParts } from './nativeWireCodec';

type Request = { resolve: (value: any) => void; reject: (error: unknown) => void; onProgress?: (progress: HistoryProgress) => void };
let worker: Worker | undefined;
let requestId = 0;
const requests = new Map<number, Request>();

const failWorker = (instance: Worker) => {
  if (worker !== instance) return;
  const error = new Error('Unable to process sync data in a worker.');
  instance.terminate(); worker = undefined;
  for (const request of requests.values()) request.reject(error);
  requests.clear();
};

const getWorker = () => {
  if (worker) return worker;
  const instance = worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module' });
  instance.onmessage = ({ data }) => {
    const request = requests.get(data.id);
    if (!request) return;
    if (data.progress) { request.onProgress?.(data.progress); return; }
    requests.delete(data.id);
    mergeSyncMetrics(data.metrics);
    if (data.conflictKeys) request.reject(new SyncConflictError(data.conflictKeys));
    else if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.value);
  };
  instance.onerror = instance.onmessageerror = () => failWorker(instance);
  return instance;
};

// Keep whole-snapshot CPU work off the UI thread. Only environments without Workers
// (including unit tests) use the same implementations directly.
function processAsync<T>(operation: string, value: unknown, fallback: () => T | Promise<T>, onProgress?: Request['onProgress']): Promise<T> {
  if (typeof Worker === 'undefined') return Promise.resolve().then(fallback);
  return new Promise((resolve, reject) => {
    const id = requestId++;
    requests.set(id, { resolve, reject, onProgress });
    // Do not transfer input buffers: the immutable encoded commit remains available
    // to the durable outbox/cache and must survive a worker failure unchanged.
    try { getWorker().postMessage({ id, operation, value }); }
    catch (error) { requests.delete(id); reject(error); }
  });
}

export const encodeAsync = (value: unknown) => processAsync('encode', value, () => encode(value));
export const decodeAsync = <T>(value: Uint8Array) => processAsync('decode', value, () => decode<T>(value));
export const encodeCacheAsync = (value: unknown) => processAsync('encodeCache', value, () => encodeCache(value));
export const decodeCacheAsync = <T>(value: Uint8Array) => processAsync('decodeCache', value, () => decodeCache<T>(value));
// Tree messages duplicate contentStore bodies; omit them before structured-cloning into the worker.
function withoutDerivedMessages(value: Snapshot): Snapshot {
  return { ...value, state: { ...value.state,
    chats: value.state.chats?.map(chat => chat.branchTree ? { ...chat, messages: [] } : chat) } };
}
export const toRecordsAsync = (value: Snapshot) => {
  const projected = withoutDerivedMessages(value);
  return processAsync('toRecords', projected, () => toRecords(projected));
};
export const fromRecordsAsync = (value: Records, previous?: Parameters<typeof fromRecords>[1]) =>
  previous ? processAsync('fromRecordsWithContent', { records: value, previous }, () => fromRecords(value, previous))
    : processAsync('fromRecords', value, () => fromRecords(value));
export const hashRecordsAsync = (value: Records) => processAsync('hashRecords', value, () => hashRecords(value));
export const hashCommitsAsync = (value: Record<string, Commit>) => processAsync('hashCommits', value, () => hashCommits(value));
export const sameSnapshotAsync = (a: Snapshot, b: Snapshot) => {
  const projected: [Snapshot, Snapshot] = [withoutDerivedMessages(a), withoutDerivedMessages(b)];
  return processAsync('sameSnapshot', projected, () => sameSnapshot(projected));
};
export const replayHistoryAsync = (value: Parameters<typeof replayHistory>[0]) => processAsync('replayHistory', value, () => replayHistory(value, syncHistoryProgress), syncHistoryProgress);
export const collectHistoryAsync = (value: Parameters<typeof collectHistory>[0]) => processAsync('collectHistory', value, () => collectHistory(value, syncHistoryProgress), syncHistoryProgress);
export const decodePartsAsync = <T>(value: Uint8Array[]) => processAsync('decodeParts', value, () => decodeParts<T>(value));
export const encodeWireAsync = (value: Parameters<typeof encodeWire>[0], full?: Uint8Array) =>
  processAsync('encodeWire', { value, full }, () => encodeWire(value, full));
export const decodeWirePartsAsync = <T>(value: Uint8Array[]) => processAsync<{ bytes: Uint8Array; value: T }>('decodeWireParts', value, async () => {
  const bytes = new Uint8Array(value.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of value) { bytes.set(part, offset); offset += part.length; }
  return { bytes, value: await decodeWire<T>(bytes) };
});
export const prepareHydratedDataAsync = (value: Parameters<typeof prepareHydratedData>[0]) => processAsync('prepareHydratedData', value, () => prepareHydratedData(structuredClone(value)));
export const prepareSaveAsync = (value: Parameters<typeof prepareSave>[0]) => processAsync('prepareSave', value, () => prepareSave(structuredClone(value)));

export const encodeNativeAsync = (value: unknown) => processAsync('encodeNative', value, () => encodeNativeWire(value));
export const hashNativeCommitsAsync = (value: Record<string, Commit>) => processAsync('hashNativeCommits', value, () => hashNativeCommits(value));
export const decodeNativePartsAsync = <T>(value: Uint8Array[]) => processAsync('decodeNativeParts', value, () => decodeNativeParts<T>(value));
