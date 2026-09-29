// Separate encrypted sync metadata: the application's existing IndexedDB schema is untouched.
export async function syncCache(id: string, value?: Uint8Array): Promise<Uint8Array | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('weavelet-google-sync', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const tx = db.transaction('sessions', value ? 'readwrite' : 'readonly');
      const request = value ? tx.objectStore('sessions').put(value, id) : tx.objectStore('sessions').get(id);
      tx.oncomplete = () => resolve(value ? undefined : request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Unable to save sync progress.'));
      tx.onerror = () => reject(tx.error ?? new Error('Unable to save sync progress.'));
    });
  } finally { db.close(); }
}
