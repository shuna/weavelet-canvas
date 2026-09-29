import { recordMetric } from './metrics';
// Only this sync-private database changes. Existing chat IndexedDB/localStorage remain untouched.
async function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('weavelet-google-sync', 2);
    request.onupgradeneeded = () => {
      for (const name of ['sessions', 'entries']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}
export async function readSyncEntries(dataset: string, keys: string[]): Promise<(Uint8Array | undefined)[]> {
  const started = performance.now();
  const db = await openCache();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readonly');
      const requests = keys.map(key => tx.objectStore('entries').get([dataset, key]));
      tx.oncomplete = () => resolve(requests.map(r => r.result));
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Unable to read sync cache.'));
    });
  } finally { db.close(); recordMetric('cache', started); }
}
export async function writeSyncCache(dataset: string, value: Uint8Array | undefined,
  entries: [string, Uint8Array][] = [], remove: string[] = []) {
  const started = performance.now();
  const db = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'entries'], 'readwrite');
      if (value) tx.objectStore('sessions').put(value, dataset);
      for (const [key, bytes] of entries) tx.objectStore('entries').put(bytes, [dataset, key]);
      for (const key of remove) tx.objectStore('entries').delete([dataset, key]);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Unable to save sync progress.'));
    });
  } finally { db.close(); recordMetric('cache', started, (value?.length ?? 0) + entries.reduce((n, [, b]) => n + b.length, 0)); }
}
export async function syncCache(id: string, value?: Uint8Array): Promise<Uint8Array | undefined> {
  if (value) { await writeSyncCache(id, value); return; }
  const started = performance.now();
  const db = await openCache();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').get(id);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Unable to read sync progress.'));
    });
  } finally { db.close(); recordMetric('cache', started); }
}
