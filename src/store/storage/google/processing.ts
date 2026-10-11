import { encode, decode } from './crypto';
import { toRecords, fromRecords, hashRecords, sameSnapshot, type Snapshot, type Records } from './records';
import { mergeSyncMetrics } from './metrics';
import { hashCommits, replayHistory, type Commit } from './replay';
import { decodeParts } from './decodeParts';
import { SyncConflictError } from './records';
import { prepareHydratedData } from '../../rehydrateData';
import { prepareSave } from '../prepareSave';

type Request = { resolve: (value: any) => void; reject: (error: unknown) => void };
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
function processAsync<T>(operation: string, value: unknown, fallback: () => T | Promise<T>): Promise<T> {
  if (typeof Worker === 'undefined') return Promise.resolve().then(fallback);
  return new Promise((resolve, reject) => {
    const id = requestId++;
    requests.set(id, { resolve, reject });
    // Do not transfer input buffers: the immutable encoded commit remains available
    // to the durable outbox/cache and must survive a worker failure unchanged.
    try { getWorker().postMessage({ id, operation, value }); }
    catch (error) { requests.delete(id); reject(error); }
  });
}

export const encodeAsync = (value: unknown) => processAsync('encode', value, () => encode(value));
export const decodeAsync = <T>(value: Uint8Array) => processAsync('decode', value, () => decode<T>(value));
export const toRecordsAsync = (value: Snapshot) => processAsync('toRecords', value, () => toRecords(value));
export const fromRecordsAsync = (value: Records) => processAsync('fromRecords', value, () => fromRecords(value));
export const hashRecordsAsync = (value: Records) => processAsync('hashRecords', value, () => hashRecords(value));
export const hashCommitsAsync = (value: Record<string, Commit>) => processAsync('hashCommits', value, () => hashCommits(value));
export const sameSnapshotAsync = (a: Snapshot, b: Snapshot) => processAsync('sameSnapshot', [a, b], () => sameSnapshot([a, b]));
export const replayHistoryAsync = (value: Parameters<typeof replayHistory>[0]) => processAsync('replayHistory', value, () => replayHistory(value));
export const decodePartsAsync = <T>(value: Uint8Array[]) => processAsync('decodeParts', value, () => decodeParts<T>(value));
export const prepareHydratedDataAsync = (value: Parameters<typeof prepareHydratedData>[0]) => processAsync('prepareHydratedData', value, () => prepareHydratedData(structuredClone(value)));
export const prepareSaveAsync = (value: Parameters<typeof prepareSave>[0]) => processAsync('prepareSave', value, () => prepareSave(structuredClone(value)));
