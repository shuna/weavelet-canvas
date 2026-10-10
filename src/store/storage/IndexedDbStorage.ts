import { findPersistedDataIntegrityErrors, computeChatFingerprint } from './prepareSave';
import { prepareSaveAsync } from './google/processing';
import {
  getStreamingChatIds,
  isStreamingContentHash,
} from '@utils/streamingBuffer';
import { debugReport } from '@store/debug-store';
import { STORE_VERSION } from '@store/version';
import {
  type PersistedChatData,
  migratePersistedState,
} from '@store/persistence';
import type { StoreState } from '@store/store';
import type { ContentStoreData } from '@utils/contentStore';
import {
  addContent,
  flushPendingGC,
  getPendingGCHashes,
} from '@utils/contentStore';
import type { BranchClipboard, ChatInterface } from '@type/chat';
import { ensureUniqueChatIds } from '@utils/chatIdentity';
import {
  packedKey,
  isPackedKey,
  isCompressionSupported,
  compressChatRecord,
  decompressChatRecord,
} from './CompressionService';

const DB_NAME = 'weavelet-canvas';
const DB_VERSION = 1;
const STORE_NAME = 'persisted-state';

// Legacy key (pre-Phase 2)
const LEGACY_KEY = 'chat-data';

// New key structure
const META_KEY = 'meta';
const CONTENT_STORE_KEY = 'content-store';
const BRANCH_CLIPBOARD_KEY = 'branch-clipboard';
const chatKey = (id: string) => `chat:${id}`;

type PersistedChat = Omit<ChatInterface, 'messages'> & {
  messages?: ChatInterface['messages'];
};

interface MetaRecord {
  lastContentEditedAt?: number;
  version: number;
  generation: number;
  activeChatId?: string;
  /** Authoritative set of chat IDs at the time of commit.
   *  Used to filter out orphaned chat keys that survived a crash before Step 4 cleanup. */
  chatIds?: string[];
}

interface ChatRecord {
  chat: PersistedChat;
  generation: number;
}

interface ContentStoreRecord {
  data: ContentStoreData;
  generation: number;
}

interface BranchClipboardRecord {
  data: BranchClipboard | null;
  generation: number;
}

// Legacy format
type LegacyChatDataRecord = PersistedChatData & {
  version: number;
};

export interface IndexedDbRecoveryChatSnapshot {
  key: string;
  packed: boolean;
  generation?: number;
  compressedBytes?: number;
  compressedBase64?: string;
  record?: ChatRecord;
  error?: string;
}

export interface IndexedDbRecoverySnapshot {
  databaseName: typeof DB_NAME;
  storeName: typeof STORE_NAME;
  collectedAt: string;
  keys: string[];
  meta?: MetaRecord;
  legacy?: LegacyChatDataRecord;
  contentStore?: ContentStoreRecord;
  branchClipboard?: BranchClipboardRecord;
  chats: IndexedDbRecoveryChatSnapshot[];
}

export type ChatDataLoadStatus = 'ok' | 'degraded';

export type ChatDataLoadResult = PersistedChatData & {
  loadStatus: ChatDataLoadStatus;
  missingChatIds: string[];
  errors: string[];
  repairedMissingContentHashes?: string[];
};

let currentGeneration = 0;
let previousContentStoreSnapshot: ContentStoreData = {};
let migrationInProgress = false;
let chatDataWritesBlocked = false;
let storageMutationQueue: Promise<void> = Promise.resolve();
let hasLoadedCommittedSnapshot = false;

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
  });

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const withCrossContextStorageLock = async <T>(run: () => Promise<T>, timeoutMs?: number): Promise<T> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return run();
  const controller = new AbortController();
  // Bound acquisition only. Never interrupt an acquired lock or a database commit.
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await navigator.locks.request(
      `${DB_NAME}:${STORE_NAME}:mutation`,
      { mode: 'exclusive', signal: controller.signal },
      () => {
        clearTimeout(timer);
        return run();
      }
    );
  } catch (error) {
    if (controller.signal.aborted) throw new Error('別の画面の保存処理が30秒以内に完了しませんでした。保存中の画面を確認し、読み込みを再試行してください。既存データへの書き込みは停止しています。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const enqueueStorageMutation = <T>(run: () => Promise<T>): Promise<T> => {
  const result = storageMutationQueue.then(run, run);
  storageMutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

export function setChatDataWritesBlocked(blocked: boolean): void {
  chatDataWritesBlocked = blocked;
  if (blocked) cancelCompression();
}

export function areChatDataWritesBlocked(): boolean {
  return chatDataWritesBlocked;
}

const hasIndexedDb = () =>
  typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

const openDatabase = async (): Promise<IDBDatabase> => {
  if (!hasIndexedDb()) {
    throw new Error('IndexedDB is not available in this environment');
  }

  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
};

/** Low-level IDB helpers */
const idbGet = <T>(store: IDBObjectStore, key: string): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error(`IDB get failed: ${key}`));
  });

const idbPut = (store: IDBObjectStore, key: string, value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`IDB put failed: ${key}`));
  });

const idbDelete = (store: IDBObjectStore, key: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`IDB delete failed: ${key}`));
  });

const idbGetAllKeys = (store: IDBObjectStore): Promise<IDBValidKey[]> =>
  new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB getAllKeys failed'));
  });

const withTransaction = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T> => {
  const database = await openDatabase();
  try {
    const tx = database.transaction(STORE_NAME, mode);
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    try {
      const result = await run(store);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already have completed or aborted.
      }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    database.close();
  }
};

/**
 * Collect all contentHashes referenced by chats and branchClipboard.
 */
function collectReferencedHashes(
  chats: PersistedChat[],
  clipboard: BranchClipboard | null
): Set<string> {
  const refs = new Set<string>();
  for (const chat of chats) {
    if (
      chat.branchTree?.nodes &&
      typeof chat.branchTree.nodes === 'object' &&
      !Array.isArray(chat.branchTree.nodes)
    ) {
      for (const node of Object.values(chat.branchTree.nodes)) {
        refs.add(node.contentHash);
      }
    }
  }
  if (
    clipboard?.nodes &&
    typeof clipboard.nodes === 'object' &&
    !Array.isArray(clipboard.nodes)
  ) {
    for (const node of Object.values(clipboard.nodes)) {
      refs.add(node.contentHash);
    }
  }
  return refs;
}

function repairMissingContentReferences(
  inputChats: PersistedChat[],
  inputContentStore: ContentStoreData,
  inputClipboard: BranchClipboard | null
): {
  chats: PersistedChat[];
  contentStore: ContentStoreData;
  clipboard: BranchClipboard | null;
  repairedHashes: string[];
} {
  let chats = inputChats;
  let contentStore = inputContentStore;
  let clipboard = inputClipboard;
  const repairedHashes: string[] = [];

  const ensureStoreCopy = () => {
    if (contentStore === inputContentStore) contentStore = { ...inputContentStore };
  };

  inputChats.forEach((chat, chatIndex) => {
    const tree = chat?.branchTree;
    if (!tree?.nodes || typeof tree.nodes !== 'object' || Array.isArray(tree.nodes)) return;

    let repairedChat: PersistedChat | undefined;
    for (const node of Object.values(tree.nodes)) {
      const missingHash = node?.contentHash;
      if (
        typeof missingHash !== 'string' ||
        isStreamingContentHash(missingHash) ||
        contentStore[missingHash]
      ) {
        continue;
      }

      const activeIndex = Array.isArray(tree.activePath)
        ? tree.activePath.indexOf(node.id)
        : -1;
      const legacyMessage = activeIndex >= 0 ? chat.messages?.[activeIndex] : undefined;
      const recoveredContent =
        legacyMessage?.role === node.role && Array.isArray(legacyMessage.content)
          ? legacyMessage.content
          : [];

      ensureStoreCopy();
      if (!repairedChat) {
        if (chats === inputChats) chats = inputChats.slice();
        repairedChat = {
          ...chat,
          branchTree: {
            ...tree,
            nodes: { ...tree.nodes },
          },
        };
        chats[chatIndex] = repairedChat;
      }
      repairedChat.branchTree!.nodes[node.id] = {
        ...node,
        contentHash: addContent(contentStore, recoveredContent),
      };
      repairedHashes.push(missingHash);
    }
  });

  if (
    inputClipboard?.nodes &&
    typeof inputClipboard.nodes === 'object' &&
    !Array.isArray(inputClipboard.nodes)
  ) {
    let repairedNodes: BranchClipboard['nodes'] | undefined;
    for (const node of Object.values(inputClipboard.nodes)) {
      const missingHash = node?.contentHash;
      if (
        typeof missingHash !== 'string' ||
        isStreamingContentHash(missingHash) ||
        contentStore[missingHash]
      ) {
        continue;
      }
      ensureStoreCopy();
      repairedNodes ??= { ...inputClipboard.nodes };
      repairedNodes[node.id] = {
        ...node,
        contentHash: addContent(contentStore, []),
      };
      repairedHashes.push(missingHash);
    }
    if (repairedNodes) clipboard = { ...inputClipboard, nodes: repairedNodes };
  }

  return { chats, contentStore, clipboard, repairedHashes };
}

/**
 * Build content store for commit. Since releaseContent now defers GC
 * (entries with refCount<=0 stay in store), the store itself is already
 * a superset containing both active and pending-GC entries.
 * We just shallow-copy to avoid mutating the original during the commit.
 */
function buildSupersetForCommit(
  currentStore: ContentStoreData
): ContentStoreData {
  return { ...currentStore };
}

/**
 * Run residual GC: remove content-store entries not referenced by any chat or clipboard.
 * Also accounts for delta chain dependencies.
 */
function runResidualGC(
  contentStore: ContentStoreData,
  chats: PersistedChat[],
  clipboard: BranchClipboard | null
): ContentStoreData {
  const refs = collectReferencedHashes(chats, clipboard);

  // Also keep entries that are delta bases for referenced entries
  const needed = new Set<string>(refs);
  for (const hash of refs) {
    let cur = hash;
    while (contentStore[cur]?.delta) {
      cur = contentStore[cur].delta!.baseHash;
      needed.add(cur);
    }
  }

  const cleaned: ContentStoreData = {};
  for (const [hash, entry] of Object.entries(contentStore)) {
    if (needed.has(hash)) {
      cleaned[hash] = entry;
    }
  }
  return cleaned;
}

// ─── Migration control ───

export function setMigrationInProgress(v: boolean): void {
  migrationInProgress = v;
}

export function isMigrationInProgress(): boolean {
  return migrationInProgress;
}

// ─── Migration from legacy single-key format ───

/**
 * Migrate legacy single-key data to the split-key format.
 * No schema-level migration is performed — data is moved as-is.
 */
async function migrateLegacyData(
  _baseState: StoreState,
  onProgress?: (progress: ChatDataLoadProgress) => void
): Promise<ChatDataLoadResult | null> {
  const database = await openDatabase();
  try {
    const tx1 = database.transaction(STORE_NAME, 'readonly');
    const store1 = tx1.objectStore(STORE_NAME);
    const legacy = await idbGet<LegacyChatDataRecord>(store1, LEGACY_KEY);
    await new Promise<void>((r) => { tx1.oncomplete = () => r(); });

    if (!legacy) return null;

    const legacyVersion = typeof legacy.version === 'number' ? legacy.version : 0;

    // Raise the needs-migration flag if data predates current schema
    if (legacyVersion < STORE_VERSION) {
      migratePersistedState(legacy, legacyVersion);
    }

    // Rehydrate has always repaired invalid/duplicate IDs and malformed node
    // maps. Apply the same non-destructive normalization to a migration copy
    // before integrity validation, otherwise repairable legacy data is locked
    // behind the recovery banner forever.
    const legacyChats = ((legacy.chats ?? []) as PersistedChat[]).map((chat) => {
      if (!chat || typeof chat !== 'object' || !chat.branchTree) return chat;
      const nodes = chat.branchTree.nodes;
      return {
        ...chat,
        branchTree: {
          ...chat.branchTree,
          nodes:
            nodes && typeof nodes === 'object' && !Array.isArray(nodes)
              ? { ...nodes }
              : {},
        },
      };
    });
    if (legacyChats.every((chat) => chat && typeof chat === 'object')) {
      ensureUniqueChatIds(legacyChats as ChatInterface[]);
    }

    const chatData: PersistedChatData = {
      lastContentEditedAt: legacy.lastContentEditedAt,
      chats: legacyChats,
      contentStore: legacy.contentStore,
      branchClipboard: legacy.branchClipboard ?? null,
    };

    const chats = (chatData.chats ?? []) as PersistedChat[];
    const integrityErrors = findPersistedDataIntegrityErrors(
      chats,
      chatData.contentStore ?? {},
      chatData.branchClipboard ?? null,
      { allowTransientStreamingHashes: true }
    );
    if (integrityErrors.length > 0) {
      return {
        ...chatData,
        loadStatus: 'degraded',
        missingChatIds: [],
        errors: integrityErrors,
      };
    }
    const gen = 1;

    const tx2 = database.transaction(STORE_NAME, 'readwrite');
    const store2 = tx2.objectStore(STORE_NAME);

    await idbPut(store2, CONTENT_STORE_KEY, {
      data: chatData.contentStore ?? {},
      generation: gen,
    });

    onProgress?.({ stage: 'migrating', completed: 0, total: chats.length });
    for (let index = 0; index < chats.length; index++) {
      const chat = chats[index];
      await idbPut(store2, chatKey(chat.id), { chat, generation: gen });
      onProgress?.({ stage: 'migrating', completed: index + 1, total: chats.length });
    }

    await idbPut(store2, BRANCH_CLIPBOARD_KEY, {
      data: chatData.branchClipboard ?? null,
      generation: gen,
    });

    // Preserve the original version so subsequent loads can detect
    // that the data has not been schema-migrated.
    await idbPut(store2, META_KEY, {
      version: legacyVersion,
      lastContentEditedAt: chatData.lastContentEditedAt,
      generation: gen,
      chatIds: chats.map((c) => c.id),
    } satisfies MetaRecord);

    await idbDelete(store2, LEGACY_KEY);

    await new Promise<void>((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onabort = () => reject(tx2.error ?? new Error('Migration transaction aborted'));
      tx2.onerror = () => reject(tx2.error ?? new Error('Migration transaction failed'));
    });

    currentGeneration = gen;
    hasLoadedCommittedSnapshot = true;
    previousContentStoreSnapshot = { ...(chatData.contentStore ?? {}) };

    return {
      ...chatData,
      loadStatus: 'ok',
      missingChatIds: [],
      errors: [],
    };
  } finally {
    database.close();
  }
}

// ─── Public API ───

/**
 * Load chat data from IndexedDB. Handles:
 * 1. Migration from legacy single-key format
 * 2. New per-chat key format with generation-based recovery
 */
export interface ChatDataLoadProgress {
  stage: 'opening' | 'lock' | 'reading' | 'restoringChats' | 'validating' | 'fingerprinting' | 'migrating';
  completed?: number;
  total?: number;
}

export const loadChatData = async (
  baseState: StoreState,
  onProgress?: (progress: ChatDataLoadProgress) => void
): Promise<ChatDataLoadResult | null> => {
  if (!hasIndexedDb()) return null;

  onProgress?.({ stage: 'opening' });
  const database = await openDatabase();
  try {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const txDone = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);

    const [legacy, meta] = await Promise.all([
      idbGet<LegacyChatDataRecord>(store, LEGACY_KEY),
      idbGet<MetaRecord>(store, META_KEY),
    ]);

    await txDone;
    database.close();

    // If legacy data exists and no meta, migrate storage format (not schema)
    if (legacy && !meta) {
      onProgress?.({ stage: 'lock' });
      const migrated = await enqueueStorageMutation(() => withCrossContextStorageLock(() => migrateLegacyData(baseState, onProgress), 30_000));
      if (migrated) return migrated;

      // Another tab may have completed the migration while this tab waited
      // for the mutation lock. Re-read the committed format rather than
      // treating the store as empty and starting a destructive first save.
      return loadChatData(baseState, onProgress);
    }

    if (!meta) return null;

    onProgress?.({ stage: 'lock' });
    return await withCrossContextStorageLock(async () => {
      // The meta observed before waiting for the lock may already be stale.
      const currentMeta = await withTransaction('readonly', (store) =>
        idbGet<MetaRecord>(store, META_KEY)
      );
      return currentMeta ? loadSplitData(currentMeta, onProgress) : null;
    }, 30_000);
  } catch (e) {
    database.close();
    throw e;
  }
};

async function loadSplitData(
  meta: MetaRecord,
  onProgress?: (progress: ChatDataLoadProgress) => void
): Promise<ChatDataLoadResult | null> {
  const G = meta.generation;
  onProgress?.({ stage: 'reading' });

  const database = await openDatabase();
  try {
    const keyTx = database.transaction(STORE_NAME, 'readonly');
    const keyTxDone = transactionDone(keyTx);
    const allKeys = await idbGetAllKeys(keyTx.objectStore(STORE_NAME));
    await keyTxDone;
    const rawChatKeys = (allKeys as string[]).filter(
      (k) => typeof k === 'string' && k.startsWith('chat:') && !isPackedKey(k)
    );
    const packedChatKeys = (allKeys as string[]).filter(
      (k) => typeof k === 'string' && isPackedKey(k)
    );

    // Start a fresh transaction and issue every record request synchronously,
    // without awaiting a prior request in that transaction. Gzip
    // decompression happens only after recordTxDone.
    const recordTx = database.transaction(STORE_NAME, 'readonly');
    const recordTxDone = transactionDone(recordTx);
    const recordStore = recordTx.objectStore(STORE_NAME);
    const [csRecord, cbRecord, rawValues, packedValues] = await Promise.all([
      idbGet<ContentStoreRecord>(recordStore, CONTENT_STORE_KEY),
      idbGet<BranchClipboardRecord>(recordStore, BRANCH_CLIPBOARD_KEY),
      Promise.all(rawChatKeys.map((key) => idbGet<ChatRecord>(recordStore, key))),
      Promise.all(
        packedChatKeys.map((key) =>
          idbGet<{ compressed: Uint8Array; generation: number }>(recordStore, key)
        )
      ),
    ]);
    await recordTxDone;
    database.close();

    const total = new Set([...rawChatKeys, ...packedChatKeys.map(key => key.slice(0, -':packed'.length))]).size;
    const packedKeys = new Set(packedChatKeys);
    const completedKeys = new Set<string>();
    let lastYield = performance.now();
    const reportChat = async (key: string) => {
      completedKeys.add(key);
      onProgress?.({ stage: 'restoringChats', completed: completedKeys.size, total });
      if (performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    };
    onProgress?.({ stage: 'restoringChats', completed: 0, total });
    const errors: string[] = [];
    const chatRecords: Array<{ key: string; record: ChatRecord }> = [];
    const usableRawKeys = new Set<string>();

    // When meta and content-store describe the same committed generation,
    // meta.chatIds is authoritative. Records outside that set are leftovers
    // from an interrupted cleanup, not evidence that the committed snapshot
    // failed to load. Keep them on disk for recovery, but do not let a
    // malformed orphan permanently force the app into read-only mode.
    const csGen = csRecord?.generation ?? 0;
    const committedGen = Math.max(G, csGen);
    const authoritativeChatIds =
      csGen <= G && meta.chatIds ? new Set(meta.chatIds) : null;
    const belongsToCommittedSnapshot = (key: string) => {
      if (!authoritativeChatIds) return true;
      return authoritativeChatIds.has(key.slice('chat:'.length));
    };

    for (let i = 0; i < rawChatKeys.length; i++) {
      const key = rawChatKeys[i];
      const record = rawValues[i];
      const expectedId = key.slice('chat:'.length);
      if (
        record?.chat &&
        typeof record.chat === 'object' &&
        record.chat.id === expectedId &&
        Number.isFinite(record.generation)
      ) {
        // A raw record from an interrupted future generation is not eligible
        // for raw-first resolution. A packed record may still contain the
        // last committed version of the same chat.
        if (record.generation <= committedGen) {
          usableRawKeys.add(key);
        }
        chatRecords.push({ key, record });
      } else if (belongsToCommittedSnapshot(key)) {
        errors.push(`Invalid raw chat record: ${key}`);
      }
      if (usableRawKeys.has(key) || !packedKeys.has(packedKey(key))) await reportChat(key);
    }

    for (let i = 0; i < packedChatKeys.length; i++) {
      const pk = packedChatKeys[i];
      const rawKey = pk.slice(0, -':packed'.length);
      if (usableRawKeys.has(rawKey)) continue;

      const packed = packedValues[i];
      if (packed?.compressed) {
        try {
          const record = await decompressChatRecord<ChatRecord>(
            packed.compressed instanceof Uint8Array
              ? packed.compressed
              : new Uint8Array(packed.compressed as ArrayBufferLike)
          );
          const expectedId = rawKey.slice('chat:'.length);
          if (!record?.chat || record.chat.id !== expectedId) {
            throw new Error(`Packed chat id does not match key: ${expectedId}`);
          }
          chatRecords.push({
            key: rawKey,
            record: { ...record, generation: packed.generation },
          });
          const invalidRawError = `Invalid raw chat record: ${rawKey}`;
          const invalidRawIndex = errors.indexOf(invalidRawError);
          if (invalidRawIndex >= 0) errors.splice(invalidRawIndex, 1);
        } catch (e) {
          console.warn(`[IndexedDb] Failed to decompress ${pk}, skipping`, e);
          if (belongsToCommittedSnapshot(rawKey)) {
            errors.push(`Failed to decompress packed chat: ${pk}`);
          }
        }
      } else if (belongsToCommittedSnapshot(rawKey)) {
        errors.push(`Invalid packed chat record: ${pk}`);
      }
      await reportChat(rawKey);
    }

    // ── Generation reconciliation ──

    // Determine the effective committed generation.
    // content-store is written first (step 1), so it may be ahead of meta.

    // Chat records: filter by generation AND by the authoritative chat ID list
    // stored in meta. This prevents deleted chats from resurrecting when the
    // app crashes after Step 3 (meta written) but before Step 4 (stale key cleanup).
    //
    // However, if csGen > G (content-store was written but meta was not updated),
    // meta.chatIds is stale and may not include chats added in the newer generation.
    // In that case, skip chatIds filtering to avoid dropping valid new chats.
    let chats: PersistedChat[] = [];
    for (const { record } of chatRecords) {
      if (record.generation > committedGen) {
        console.warn(
          `[IndexedDb] Discarding chat with generation ${record.generation} > committed ${committedGen}`
        );
        continue;
      }
      // If meta has chatIds, only accept chats in that set
      if (authoritativeChatIds && !authoritativeChatIds.has(record.chat.id)) {
        console.warn(
          `[IndexedDb] Discarding orphaned chat ${record.chat.id} not in meta.chatIds`
        );
        continue;
      }
      chats.push(record.chat);
    }

    // Reorder chats to match the authoritative order stored in meta.chatIds
    if (meta.chatIds) {
      const orderMap = new Map(meta.chatIds.map((id, i) => [id, i]));
      chats.sort((a, b) => {
        const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }

    // Clipboard: accept if generation <= committedGen, otherwise discard
    // (clipboard is written alongside chats in step 2)
    let clipboard: BranchClipboard | null = null;
    if (cbRecord) {
      if (cbRecord.generation <= committedGen) {
        clipboard = cbRecord.data;
      } else {
        console.warn(
          `[IndexedDb] Discarding clipboard with generation ${cbRecord.generation} > committed ${committedGen}`
        );
      }
    }

    currentGeneration = committedGen;
    hasLoadedCommittedSnapshot = true;

    // Raise the needs-migration flag if stored data predates current schema
    if (meta.version < STORE_VERSION) {
      migratePersistedState({}, meta.version);
    }

    let contentStore = csRecord?.data ?? {};
    if (!csRecord || !csRecord.data || typeof csRecord.data !== 'object') {
      errors.push('Missing or invalid content-store record');
    }

    onProgress?.({ stage: 'validating' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const repairedContent = repairMissingContentReferences(
      chats,
      contentStore,
      clipboard
    );
    chats = repairedContent.chats;
    contentStore = repairedContent.contentStore;
    clipboard = repairedContent.clipboard;

    const recoveredChatIds = new Set(chats.map((chat) => chat.id));
    const missingChatIds = (meta.chatIds ?? []).filter((id) => !recoveredChatIds.has(id));
    for (const id of missingChatIds) {
      errors.push(`Missing committed chat: ${id}`);
    }

    errors.push(...findPersistedDataIntegrityErrors(chats, contentStore, clipboard, {
      allowTransientStreamingHashes: true,
    }));

    const loadStatus: ChatDataLoadStatus = errors.length > 0 ? 'degraded' : 'ok';

    // Run residual GC to clean up any leftover superset entries
    // only after a complete load. A partial load must never discard content
    // belonging to a chat that could not be decoded.
    if (loadStatus === 'ok') {
      contentStore = runResidualGC(contentStore, chats, clipboard);
    }

    previousContentStoreSnapshot = { ...contentStore };

    // Initialize chat snapshot for differential writes
    previousChatSnapshot = new Map();
    onProgress?.({ stage: 'fingerprinting', completed: 0, total: chats.length });
    for (let index = 0; index < chats.length; index++) {
      const chat = chats[index];
      previousChatSnapshot.set(chat.id, computeChatFingerprint(chat as PersistedChat));
      onProgress?.({ stage: 'fingerprinting', completed: index + 1, total: chats.length });
      if (performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }

    return {
      chats,
      lastContentEditedAt: meta.lastContentEditedAt,
      contentStore,
      branchClipboard: clipboard,
      loadStatus,
      missingChatIds,
      errors,
      repairedMissingContentHashes: repairedContent.repairedHashes,
    };
  } catch (e) {
    database.close();
    throw e;
  }
}

async function collectIndexedDbRecoverySnapshotUnlocked(): Promise<IndexedDbRecoverySnapshot | null> {
  if (!hasIndexedDb()) return null;

  const database = await openDatabase();
  try {
    const keyTx = database.transaction(STORE_NAME, 'readonly');
    const keyTxDone = transactionDone(keyTx);
    const allKeys = await idbGetAllKeys(keyTx.objectStore(STORE_NAME));
    await keyTxDone;
    const keys = allKeys
      .filter((key): key is string => typeof key === 'string')
      .sort();

    if (keys.length === 0) {
      return null;
    }

    const rawChatKeys = keys.filter(
      (key) => key.startsWith('chat:') && !isPackedKey(key)
    );
    const packedChatKeys = keys.filter(isPackedKey);
    const recordTx = database.transaction(STORE_NAME, 'readonly');
    const recordTxDone = transactionDone(recordTx);
    const recordStore = recordTx.objectStore(STORE_NAME);
    const [meta, legacy, contentStore, branchClipboard, rawValues, packedValues] = await Promise.all([
      idbGet<MetaRecord>(recordStore, META_KEY),
      idbGet<LegacyChatDataRecord>(recordStore, LEGACY_KEY),
      idbGet<ContentStoreRecord>(recordStore, CONTENT_STORE_KEY),
      idbGet<BranchClipboardRecord>(recordStore, BRANCH_CLIPBOARD_KEY),
      Promise.all(rawChatKeys.map((key) => idbGet<ChatRecord>(recordStore, key))),
      Promise.all(
        packedChatKeys.map((key) =>
          idbGet<{ compressed: Uint8Array; generation: number }>(recordStore, key)
        )
      ),
    ]);
    await recordTxDone;

    const chats: IndexedDbRecoveryChatSnapshot[] = [];

    for (let i = 0; i < rawChatKeys.length; i++) {
      const key = rawChatKeys[i];
      const record = rawValues[i];
      chats.push({
        key,
        packed: false,
        generation: record?.generation,
        record,
      });
    }

    for (let i = 0; i < packedChatKeys.length; i++) {
      const key = packedChatKeys[i];
      const packed = packedValues[i];
      const snapshot: IndexedDbRecoveryChatSnapshot = {
        key: key.slice(0, -':packed'.length),
        packed: true,
        generation: packed?.generation,
      };

      if (packed?.compressed) {
        try {
          const compressed = packed.compressed instanceof Uint8Array
            ? packed.compressed
            : new Uint8Array(packed.compressed as ArrayBufferLike);
          snapshot.compressedBytes = compressed.byteLength;
          snapshot.compressedBase64 = bytesToBase64(compressed);
          snapshot.record = await decompressChatRecord<ChatRecord>(compressed);
        } catch (error) {
          snapshot.error = error instanceof Error ? error.message : String(error);
        }
      }

      chats.push(snapshot);
    }

    const snapshot: IndexedDbRecoverySnapshot = {
      databaseName: DB_NAME,
      storeName: STORE_NAME,
      collectedAt: new Date().toISOString(),
      keys,
      meta,
      legacy,
      contentStore,
      branchClipboard,
      chats,
    };

    return snapshot;
  } finally {
    database.close();
  }
}

export const collectIndexedDbRecoverySnapshot = (
  options: { consistent?: boolean } = {}
): Promise<IndexedDbRecoverySnapshot | null> =>
  options.consistent === false
    ? collectIndexedDbRecoverySnapshotUnlocked()
    : withCrossContextStorageLock(collectIndexedDbRecoverySnapshotUnlocked);

/**
 * Track chat IDs from the previous save for differential writes.
 */
let previousChatSnapshot: Map<string, string> = new Map(); // id → JSON hash of chat

/**
 * Save chat data using the generation-based commit protocol:
 * 1. Write content-store (superset — entries with refCount<=0 retained)
 * 2. Write changed chats + branch-clipboard
 * 3. Write meta (commit marker)
 * 4. GC (deferred, safe to skip on crash)
 */
const saveChatDataUnlocked = async (data: PersistedChatData, prepared: Awaited<ReturnType<typeof prepareSaveAsync>>): Promise<void> => {
  if (!hasIndexedDb()) return;
  if (chatDataWritesBlocked) {
    throw new Error('Chat data writes are blocked because persisted data did not load safely');
  }
  debugReport('idb-save', { label: 'IndexedDB Save', status: 'active' });
  if (migrationInProgress) {
    throw new Error('Chat data save deferred because migration is in progress');
  }

  const diskMeta = await withTransaction('readonly', (store) =>
    idbGet<MetaRecord>(store, META_KEY)
  );
  if (
    diskMeta &&
    diskMeta.generation > currentGeneration &&
    hasLoadedCommittedSnapshot
  ) {
    throw new Error(
      'Refusing to overwrite chat data because a newer generation was saved by another context'
    );
  }
  currentGeneration = Math.max(currentGeneration, diskMeta?.generation ?? 0);
  const nextGen = currentGeneration + 1;
  const chats = (prepared.data.chats ?? []) as PersistedChat[];
  const contentStore = prepared.data.contentStore ?? {};
  const clipboard = prepared.data.branchClipboard ?? null;
  const integrityErrors = prepared.errors;
  if (integrityErrors.length > 0) {
    throw new Error(`Refusing to persist inconsistent chat data: ${integrityErrors.join('; ')}`);
  }
  if ((diskMeta?.chatIds?.length ?? 0) > 0 && chats.length === 0) {
    throw new Error('Refusing to replace a non-empty committed store with an empty chat list');
  }

  // Worker preparation already captured an owned snapshot, including pending-GC
  // entries. No second main-thread copy is needed for the commit superset.

  // Step 1: Write content-store (superset) first
  await withTransaction('readwrite', async (store) => {
    await idbPut(store, CONTENT_STORE_KEY, {
      data: contentStore,
      generation: nextGen,
    } satisfies ContentStoreRecord);
  });

  // Step 2: Write changed chats + branch-clipboard
  // Only write chats whose fingerprint differs from last save
  const changedChatIds: string[] = [];
  const newSnapshot = new Map<string, string>();
  const fingerprints = new Map(prepared.fingerprints);
  for (const chat of chats) {
    const fp = fingerprints.get(chat.id)!;
    newSnapshot.set(chat.id, fp);
    if (previousChatSnapshot.get(chat.id) !== fp) {
      changedChatIds.push(chat.id);
    }
  }

  await withTransaction('readwrite', async (store) => {
    for (const id of changedChatIds) {
      const chat = chats.find((c) => c.id === id);
      if (chat) {
        await idbPut(store, chatKey(id), {
          chat,
          generation: nextGen,
        } satisfies ChatRecord);
      }
    }
    await idbPut(store, BRANCH_CLIPBOARD_KEY, {
      data: clipboard,
      generation: nextGen,
    } satisfies BranchClipboardRecord);
  });

  // Step 3: Write meta (commit marker) with authoritative chat ID list
  await withTransaction('readwrite', async (store) => {
    await idbPut(store, META_KEY, {
      version: STORE_VERSION,
      lastContentEditedAt: prepared.data.lastContentEditedAt,
      generation: nextGen,
      chatIds: chats.map((c) => c.id),
    } satisfies MetaRecord);
  });

  currentGeneration = nextGen;
  hasLoadedCommittedSnapshot = true;

  // Step 4: Deferred GC — read-modify-write from IDB to avoid
  // overwriting content-store entries added by concurrent saves.
  const pendingGCSet = getPendingGCHashes();
  if (pendingGCSet.size > 0) {
    const hashesToGC = [...pendingGCSet];
    const protectedHashes = collectReferencedHashes(chats, clipboard);
    // Flush from in-memory snapshot (keeps Zustand contentStore clean for
    // future snapshots) and clear the global pending set.
    flushPendingGC(data.contentStore ?? {}, protectedHashes);

    await withTransaction('readwrite', async (store) => {
      const record = await idbGet<ContentStoreRecord>(store, CONTENT_STORE_KEY);
      if (!record?.data) return;

      const liveStore = record.data;
      let changed = false;
      for (const hash of hashesToGC) {
        if (protectedHashes.has(hash)) continue;
        if (liveStore[hash] && liveStore[hash].refCount <= 0) {
          delete liveStore[hash];
          changed = true;
        }
      }

      if (changed) {
        await idbPut(store, CONTENT_STORE_KEY, {
          data: liveStore,
          generation: nextGen,
        } satisfies ContentStoreRecord);
      }
    });
  }

  // Remove chat keys (both raw and packed) that no longer exist
  const currentChatIds = new Set(chats.map((c) => c.id));
  const deletedIds = [...previousChatSnapshot.keys()].filter(
    (id) => !currentChatIds.has(id)
  );
  if (deletedIds.length > 0) {
    await withTransaction('readwrite', async (store) => {
      for (const id of deletedIds) {
        await idbDelete(store, chatKey(id));
        await idbDelete(store, packedKey(chatKey(id)));
      }
    });
  }

  previousChatSnapshot = newSnapshot;
  previousContentStoreSnapshot = { ...contentStore };
  debugReport('idb-save', { status: 'done', detail: `${changedChatIds.length} chats` });
};

export const saveChatData = (data: PersistedChatData): Promise<void> =>
  enqueueStorageMutation(async () => {
    // Preserve save order, but leave other tabs free to load while the worker prepares data.
    const prepared = await prepareSaveAsync(data);
    return withCrossContextStorageLock(() => saveChatDataUnlocked(data, prepared));
  });

// ─── Copy-on-Write Compression ───

/** Active compression abort controller — only one compression cycle runs at a time */
let compressionAbort: AbortController | null = null;

/**
 * Compress a single chat with an atomic compare-and-swap transaction.
 * Returns true if compression succeeded.
 */
async function commitCompressedChatUnlocked(
  chatId: string,
  rawRecord: ChatRecord,
  compressed: Uint8Array,
  signal?: AbortSignal
): Promise<boolean> {
  if (chatDataWritesBlocked || signal?.aborted) return false;
  const key = chatKey(chatId);
  const pk = packedKey(key);
  // Compare-and-swap the raw record and packed replacement in one atomic
  // transaction. If another writer changed the chat while compression was
  // running, preserve the newer raw record.
  return withTransaction('readwrite', async (store) => {
    const currentRaw = await idbGet<ChatRecord>(store, key);
    if (
      !currentRaw?.chat ||
      currentRaw.generation !== rawRecord.generation ||
      computeChatFingerprint(currentRaw.chat) !== computeChatFingerprint(rawRecord.chat)
    ) {
      return false;
    }
    await idbPut(store, pk, {
      compressed,
      generation: rawRecord.generation,
    });
    await idbDelete(store, key);
    return true;
  });
}

export const compressSingleChat = (
  chatId: string,
  signal?: AbortSignal
): Promise<boolean> => {
  if (!isCompressionSupported() || chatDataWritesBlocked || signal?.aborted) {
    return Promise.resolve(false);
  }

  // Gzip can be relatively slow. Do the immutable read and compression before
  // taking the mutation queue/Web Lock, then use CAS for the short commit.
  return withTransaction('readonly', (store) =>
    idbGet<ChatRecord>(store, chatKey(chatId))
  ).then(async (rawRecord) => {
    if (!rawRecord?.chat || signal?.aborted || chatDataWritesBlocked) return false;
    const compressed = await compressChatRecord(rawRecord);
    if (signal?.aborted || chatDataWritesBlocked) return false;
    return enqueueStorageMutation(() =>
      withCrossContextStorageLock(() => commitCompressedChatUnlocked(chatId, rawRecord, compressed, signal))
    );
  });
};

/**
 * Decompress a single chat without overwriting an equal or newer raw record.
 * Returns true if decompression occurred.
 */
async function commitDecompressedChatUnlocked(
  chatId: string,
  packed: { compressed: Uint8Array; generation: number },
  record: ChatRecord
): Promise<boolean> {
  if (chatDataWritesBlocked) return false;
  const key = chatKey(chatId);
  const pk = packedKey(key);
  return withTransaction('readwrite', async (store) => {
    const [currentPacked, currentRaw] = await Promise.all([
      idbGet<{ compressed: Uint8Array; generation: number }>(store, pk),
      idbGet<ChatRecord>(store, key),
    ]);
    if (!currentPacked?.compressed || currentPacked.generation !== packed.generation) {
      return false;
    }
    if (currentRaw && currentRaw.generation >= packed.generation) {
      await idbDelete(store, pk);
      return false;
    }
    await idbPut(store, key, {
      chat: record.chat,
      generation: packed.generation,
    });
    await idbDelete(store, pk);
    return true;
  });
}

export const decompressSingleChat = async (chatId: string): Promise<boolean> => {
  if (chatDataWritesBlocked) return false;

  // As with compression, keep the CPU/stream work outside the mutation lock.
  // The commit re-checks the generation so a newer packed/raw record wins.
  const packed = await withTransaction('readonly', (store) =>
    idbGet<{ compressed: Uint8Array; generation: number }>(store, packedKey(chatKey(chatId)))
  );
  if (!packed?.compressed || chatDataWritesBlocked) return false;
  const compressed = packed.compressed instanceof Uint8Array
    ? packed.compressed
    : new Uint8Array(packed.compressed as ArrayBufferLike);
  const record = await decompressChatRecord<ChatRecord>(compressed);
  if (chatDataWritesBlocked) return false;
  return enqueueStorageMutation(() =>
    withCrossContextStorageLock(() => commitDecompressedChatUnlocked(chatId, { ...packed, compressed }, record))
  );
};

/**
 * Compress inactive chats. `activeChatId` is excluded.
 * Processes chats sequentially. Abortable via signal.
 */
export async function compressInactiveChats(
  activeChatId: string | undefined,
  signal?: AbortSignal
): Promise<number> {
  if (!isCompressionSupported() || chatDataWritesBlocked) return 0;

  // Find raw chat keys that are not the active chat
  const rawKeys = await withTransaction('readonly', async (store) => {
    const allKeys = await idbGetAllKeys(store);
    return (allKeys as string[]).filter(
      (k) => typeof k === 'string' && k.startsWith('chat:') && !isPackedKey(k)
    );
  });

  debugReport('compression', { label: 'Compression', status: 'active', detail: `${rawKeys.length} candidates` });
  const streamingChatIds = getStreamingChatIds();
  let compressed = 0;
  for (const key of rawKeys) {
    if (signal?.aborted) break;
    const id = key.slice('chat:'.length);
    if (id === activeChatId) continue;
    if (streamingChatIds.has(id)) continue;

    try {
      if (await compressSingleChat(id, signal)) {
        compressed++;
      }
    } catch (e) {
      console.warn(`[IndexedDb] Failed to compress chat ${id}`, e);
    }
  }
  debugReport('compression', { status: 'done', detail: `${compressed} compressed` });
  return compressed;
}

/**
 * Ensure a specific chat is decompressed (for when it becomes active).
 */
export async function ensureChatDecompressed(chatId: string): Promise<void> {
  try {
    await decompressSingleChat(chatId);
  } catch (e) {
    console.warn(`[IndexedDb] Failed to decompress chat ${chatId}`, e);
  }
}

// ─── Compression Scheduler ───

const IDLE_COMPRESS_DELAY_MS = 5 * 60 * 1000; // 5 minutes
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerActiveChatId: string | undefined;

function cancelCompression() {
  compressionAbort?.abort();
  compressionAbort = null;
}

function scheduleIdleCompression() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    triggerCompression();
  }, IDLE_COMPRESS_DELAY_MS);
}

function triggerCompression() {
  if (migrationInProgress || chatDataWritesBlocked) return;
  cancelCompression();
  const abort = new AbortController();
  compressionAbort = abort;

  const doCompress = async () => {
    if (typeof requestIdleCallback !== 'undefined') {
      await new Promise<void>((resolve) => requestIdleCallback(() => resolve()));
    }
    if (abort.signal.aborted) return;
    await compressInactiveChats(schedulerActiveChatId, abort.signal);
  };

  doCompress().catch((e) => {
    if (!abort.signal.aborted) {
      console.warn('[IndexedDb] Background compression failed', e);
    }
  });
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    // Compress when page goes to background
    triggerCompression();
  } else {
    // Cancel when returning to foreground (avoid contention)
    cancelCompression();
  }
}

/**
 * Notify the compression scheduler that the active chat changed.
 * Triggers compression of the previously active chat.
 */
export function notifyActiveChatChanged(chatId: string | undefined): void {
  if (chatDataWritesBlocked) return;
  schedulerActiveChatId = chatId;
  cancelCompression();

  // Decompress the newly active chat (if it was packed)
  if (chatId) {
    ensureChatDecompressed(chatId).then(() => {
      // After decompression, schedule compression of inactive chats
      scheduleIdleCompression();
      triggerCompression();
    });
  } else {
    scheduleIdleCompression();
    triggerCompression();
  }
}

/**
 * Initialize the compression scheduler. Call once during bootstrap.
 * Returns a cleanup function.
 */
export function initCompressionScheduler(activeChatId: string | undefined): () => void {
  if (!isCompressionSupported() || migrationInProgress || chatDataWritesBlocked) {
    return () => {};
  }

  schedulerActiveChatId = activeChatId;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  scheduleIdleCompression();

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    cancelCompression();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
}

const clearChatDataUnlocked = async (): Promise<void> => {
  if (!hasIndexedDb()) return;

  await withTransaction('readwrite', async (store) => {
    const allKeys = await idbGetAllKeys(store);
    for (const key of allKeys) {
      await idbDelete(store, key as string);
    }
  });

  currentGeneration = 0;
  hasLoadedCommittedSnapshot = false;
  previousContentStoreSnapshot = {};
  previousChatSnapshot = new Map();
};

export const clearChatData = (): Promise<void> =>
  enqueueStorageMutation(() => withCrossContextStorageLock(clearChatDataUnlocked));

// Exported for testing
export {
  collectReferencedHashes,
  buildSupersetForCommit,
  runResidualGC,
  computeChatFingerprint,
  currentGeneration as _currentGeneration,
  previousContentStoreSnapshot as _previousContentStoreSnapshot,
};

export const _resetInternalState = () => {
  currentGeneration = 0;
  hasLoadedCommittedSnapshot = false;
  previousContentStoreSnapshot = {};
  previousChatSnapshot = new Map();
  chatDataWritesBlocked = false;
  storageMutationQueue = Promise.resolve();
};
