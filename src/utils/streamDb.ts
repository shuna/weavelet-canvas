import type { ChatInterface, OpenRouterObservation, Role } from '@type/chat';
import { PENDING_RETENTION_MS } from './streamStatus';
export { PENDING_RETENTION_MS } from './streamStatus';
export interface StreamRecord {
  openRouterObservation?: OpenRouterObservation;
  requestId: string;
  chatId?: string;
  nodeId?: string;
  checkpointHash?: string;
  checkpointRole?: Role;
  appliedHash?: string;
  chatIndex: number;
  messageIndex: number;
  bufferedText: string;
  status: 'streaming' | 'completed' | 'interrupted' | 'failed';
  error?: string;
  createdAt: number;
  updatedAt: number;
  acknowledged: boolean;
  /** Proxy session ID for server-side recovery (set when proxy mode is active) */
  proxySessionId?: string;
  /** Last received proxy event ID for recovery offset */
  lastProxyEventId?: number;
  /** OpenRouter generation ID when present in the upstream stream */
  generationId?: string;
  bufferedReasoning?: string;
  llmSsePartial?: string;
  thinkTagCheckpoint?: { state: 'outside' | 'inside'; pending: string };
  llmDone?: boolean;
  proxyComplete?: boolean;
}

export interface ProxyCheckpoint {
  bufferedText: string;
  bufferedReasoning: string;
  lastProxyEventId: number;
  llmSsePartial: string;
  thinkTagCheckpoint: { state: 'outside' | 'inside'; pending: string };
  generationId?: string;
  llmDone?: boolean;
  proxyComplete?: boolean;
  openRouterObservation?: OpenRouterObservation;
}

const DB_NAME = 'sw-stream-db';
const STORE_NAME = 'requests';
const DB_VERSION = 1;
// Preserve unapplied responses for seven days, even if repeated recovery updates them.

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'requestId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction, db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export async function saveRequest(record: StreamRecord): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(record);
  await transactionDone(transaction, db);
}

/** Recovery cannot recreate a purged record or save after its target was invalidated. */
export async function saveRecoveryRecord(record: StreamRecord, isCurrent: () => boolean): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(record.requestId);
  request.onsuccess = () => {
    if (request.result && isCurrent()) store.put(record);
  };
  await transactionDone(transaction, db);
}

export async function getRequest(requestId: string): Promise<StreamRecord | undefined> {
  const db = await openDb();
  const result = await reqToPromise(tx(db, 'readonly').get(requestId));
  db.close();
  return result;
}

export async function appendText(
  requestId: string,
  text: string,
  lastProxyEventId?: number,
  generationId?: string
): Promise<void> {
  const db = await openDb();
  const store = tx(db, 'readwrite');
  const record: StreamRecord | undefined = await reqToPromise(store.get(requestId));
  if (record) {
    record.bufferedText += text;
    record.updatedAt = Date.now();
    if (lastProxyEventId !== undefined) {
      record.lastProxyEventId = lastProxyEventId;
    }
    if (generationId !== undefined) {
      record.generationId = generationId;
    }
    await reqToPromise(store.put(record));
  }
  db.close();
}

/** Persist the recovery cursor and every parser state from the same stream point. */
export async function saveProxyCheckpoint(
  requestId: string,
  checkpoint: ProxyCheckpoint,
  isCurrent?: () => boolean
): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const record: StreamRecord | undefined = await reqToPromise(store.get(requestId));
  if (record && (!isCurrent || isCurrent())) {
    store.put({ ...record, ...checkpoint, updatedAt: Date.now() });
  }
  await transactionDone(transaction, db);
}

export async function markAcknowledged(requestId: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const record: StreamRecord | undefined = await reqToPromise(store.get(requestId));
  if (record) store.put({ ...record, acknowledged: true, updatedAt: Date.now() });
  await transactionDone(transaction, db);
}

export async function setGenerationId(
  requestId: string,
  generationId: string
): Promise<void> {
  const db = await openDb();
  const store = tx(db, 'readwrite');
  const record: StreamRecord | undefined = await reqToPromise(store.get(requestId));
  if (record) {
    record.generationId = generationId;
    record.updatedAt = Date.now();
    await reqToPromise(store.put(record));
  }
  db.close();
}

export async function updateStatus(
  requestId: string,
  status: StreamRecord['status'],
  error?: string
): Promise<void> {
  const db = await openDb();
  const store = tx(db, 'readwrite');
  const record: StreamRecord | undefined = await reqToPromise(store.get(requestId));
  if (record) {
    record.status = status;
    record.updatedAt = Date.now();
    if (error !== undefined) record.error = error;
    await reqToPromise(store.put(record));
  }
  db.close();
}

export async function getAllPending(): Promise<StreamRecord[]> {
  const db = await openDb();
  const all: StreamRecord[] = await reqToPromise(tx(db, 'readonly').getAll());
  db.close();
  return all.filter((r) => !r.acknowledged);
}

export async function deleteRequest(requestId: string): Promise<void> {
  const db = await openDb();
  await reqToPromise(tx(db, 'readwrite').delete(requestId));
  db.close();
}

export async function cleanupStale(maxAgeMs: number = 3600000): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const done = transactionDone(transaction, db);
  const all: StreamRecord[] = await reqToPromise(store.getAll());
  const now = Date.now();
  for (const r of all) {
    if (now - r.createdAt > (r.acknowledged ? maxAgeMs : PENDING_RETENTION_MS)) {
      store.delete(r.requestId);
    }
  }
  await done;
}

export async function setStreamObservation(requestId: string, patch: OpenRouterObservation): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(requestId);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
    request.onsuccess = () => {
      const record = request.result as StreamRecord | undefined;
      if (record) store.put({ ...record, openRouterObservation: { ...record.openRouterObservation, ...patch }, updatedAt: Date.now() });
    };
  });
}

/** Mark the finalized node without recreating a record removed by explicit cancellation. */
export async function markStreamApplied(requestId: string, appliedHash: string, checkpointRole: Role, expectedBufferedText: string, expectedBufferedReasoning: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    const request = store.get(requestId);
    request.onsuccess = () => {
      const record = request.result as StreamRecord | undefined;
      if (record && record.status !== 'streaming' && record.bufferedText === expectedBufferedText && (record.bufferedReasoning ?? '') === expectedBufferedReasoning) store.put({ ...record, appliedHash, checkpointRole, updatedAt: Date.now() });
    };
  });
}

export interface StreamCheckpointTarget { requestId: string; chatId: string; nodeId: string }

/** Call only after the primary chat snapshot has committed. Separate DB writes may still fail. */
export async function updateStreamCheckpoints(snapshot: { chats?: Pick<ChatInterface, 'id' | 'branchTree'>[] }, targets: readonly StreamCheckpointTarget[]): Promise<StreamRecord[]> {
  const db = await openDb();
  const acknowledged: StreamRecord[] = [];
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
    const request = store.getAll();
    request.onsuccess = () => {
      for (const record of request.result as StreamRecord[]) {
        if (!record.chatId || !record.nodeId) continue;
        const node = snapshot.chats?.find(chat => chat.id === record.chatId)?.branchTree?.nodes[record.nodeId];
        const hash = node?.contentHash;
        if (!hash || hash.startsWith('__streaming:')) continue;
        if (record.status !== 'streaming' && record.appliedHash === hash && record.checkpointRole === node!.role) {
          if (record.proxySessionId && record.proxyComplete !== true) {
            store.put({ ...record, checkpointHash: hash, checkpointRole: node!.role, appliedHash: undefined });
          } else {
            store.delete(record.requestId);
            acknowledged.push(record);
          }
        }
        else if (targets.some(target => target.requestId === record.requestId && target.chatId === record.chatId && target.nodeId === record.nodeId)) {
          store.put({ ...record, checkpointHash: hash, checkpointRole: node!.role });
        }
      }
    };
  });
  return acknowledged;
}
