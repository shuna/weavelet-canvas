export interface FileSystemSyncTarget {
  handle: FileSystemDirectoryHandle;
  dataset: string;
  initialized: boolean;
  downloadPending?: boolean;
  headerId?: string;
}

export async function savedFileSystemTarget(value?: FileSystemSyncTarget | null): Promise<FileSystemSyncTarget | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('weavelet-filesystem-sync', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('target');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('target', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('target');
      const request = value === undefined ? store.get('active') : value === null ? store.delete('active') : store.put(value, 'active');
      tx.oncomplete = () => resolve(value === undefined ? request.result : value ?? undefined);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('保存先を記憶できませんでした。'));
    });
  } finally { db.close(); }
}
