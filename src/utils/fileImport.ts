import { normalizeLegacyIOSImport } from './legacyIOSImport';
import { v4 as uuidv4 } from 'uuid';

import type { StoreState } from '@store/store';
import { STORE_VERSION } from '@store/version';
import { findPersistedDataIntegrityErrors } from '@store/storage/prepareSave';
import type { LegacyRemoteSnapshot } from '@store/storage/IndexedDbStorage';
import {
  importOpenAIChatExport,
  isLegacyImport,
  isOpenAIContent,
  isSingleChatImport,
  PartialImportError,
  validateAndFixChats,
  validateExportV1,
  validateExportV2,
  validateExportV3,
  validateFolders,
} from '@utils/import';
import { flatChatToBranchTree, captureProjectedMessageAttributes, materializeActivePath } from '@utils/branchUtils';
import { assignFreshChatIds } from '@utils/chatIdentity';
import { ContentStoreData, addContent, computeContentHash, resolveContent, validateDeltaIntegrity } from '@utils/contentStore';
import { prepareChatForExport } from '@utils/chatExport';
import { isStreamingContentHash } from '@utils/streamingBuffer';
import { normalizeSystemPrompt } from '@utils/systemPromptNormalize';
import { BranchNodeLegacy, ChatInterface, Folder, FolderCollection } from '@type/chat';
import { ExportV1, ExportV2, ExportV3, OpenAIChat, OpenAIPlaygroundJSON } from '@type/export';
import type { EvaluationResultMap } from '@type/evaluation';

export type ImportResult = {
  success: boolean;
  message: string;
  status?: 'concurrent-change' | 'storage-error';
};

export type ImportMode = 'append' | 'replace';

export type Translator = (key: string, opts?: Record<string, unknown>) => string;
export type ImportType =
  | 'OpenAIContent'
  | 'LegacyImport'
  | 'SingleChat'
  | 'ExportV1'
  | 'ExportV2'
  | 'ExportV3'
  | '';

const cloneState = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const deepClone = <T,>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : cloneState(value);
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const extractModelId = (chat: unknown): string | undefined => {
  if (!isRecord(chat) || !isRecord(chat.config) || typeof chat.config.model !== 'string') {
    return undefined;
  }
  return chat.config.model;
};

// Hosts pass detached persisted data; runtime functions never enter a plan.
export const createImportPlan = (base: StoreState, mode: ImportMode, includeSettings: boolean, initial: StoreState): StoreState => ({
  // JSON-only hosts must retain explicit undefined roots until the final persisted diff.
  ...Object.fromEntries(Object.keys(mode === 'replace' && includeSettings ? initial : base).map(key => [key, undefined])),
  ...deepClone(mode === 'replace' && includeSettings ? initial : base),
  chats: mode === 'replace' ? [] : deepClone(base.chats),
  folders: mode === 'replace' ? {} : deepClone(base.folders),
  contentStore: mode === 'replace' ? {} : deepClone(base.contentStore),
  branchClipboard: mode === 'replace' ? null : deepClone(base.branchClipboard),
  evaluationResults: mode === 'replace' ? {} : deepClone(base.evaluationResults),
});

const mergeChats = (plan: StoreState, chatsToImport: ChatInterface[]) => {
  const chatIdMap: Record<string, string> = {};
  chatsToImport.forEach((chat) => {
    const prevId = chat.id;
    assignFreshChatIds([chat]);
    chatIdMap[prevId] = chat.id;
  });
  // Normalize system prompts: migrate system bubbles → config.systemPrompt
  const contentStore = plan.contentStore ?? {};
  for (const chat of chatsToImport) {
    captureProjectedMessageAttributes(chat, contentStore);
    normalizeSystemPrompt(chat, contentStore);
  }
  const existingChats = plan.chats;
  if (existingChats) {
    plan.chats = chatsToImport.concat(existingChats);
  } else {
    plan.chats = chatsToImport;
  }
  return chatIdMap;
};

const remapEvaluationResultKeys = (
  results: EvaluationResultMap | undefined,
  chatIdMap: Record<string, string>
): EvaluationResultMap => {
  if (!results) return {};
  return Object.fromEntries(
    Object.entries(results).map(([key, value]) => {
      const firstSep = key.indexOf(':');
      const secondSep = key.indexOf(':', firstSep + 1);
      if (firstSep < 0 || secondSep < 0) return [key, value];
      const chatId = key.slice(0, firstSep);
      const nextChatId = chatIdMap[chatId] ?? chatId;
      return [`${nextChatId}${key.slice(firstSep)}`, value];
    })
  );
};

const clearMissingFolderReferences = (
  chats: ChatInterface[] | undefined,
  folders: FolderCollection
) => {
  if (!chats) return;

  chats.forEach((chat) => {
    if (chat.folder && !Object.hasOwn(folders, chat.folder)) {
      delete chat.folder;
    }
  });
};

const shiftAndMergeFolders = (plan: StoreState, folders: FolderCollection) => {
  const offset = Object.keys(folders).length;
  const currentFolders = plan.folders;
  Object.values(currentFolders).forEach((folder) => {
    folder.order += offset;
  });
  plan.folders = { ...folders, ...currentFolders };
};

export type ImportDecisions = {allowPartialImport?:boolean;reduceImport?:boolean};
export type ImportDecision = {kind:'partial-import'|'reduce-import';message:string};


// Raw sync backups enter the existing import converters only by explicit file import.
export const decodeLegacyRemoteImport = (raw: LegacyRemoteSnapshot) => {
  if (!Number.isInteger(raw.version) || raw.version < 0 || raw.version >= STORE_VERSION) {
    throw new Error('この同期データの版は取り込めません。対応する版で開いてください。');
  }
  if (!isRecord(raw.state) || !Array.isArray(raw.state.chats)) {
    throw new Error('Invalid legacy remote snapshot');
  }
  const state = deepClone(raw.state);
  const chats = state.chats as ChatInterface[];
  const hasInlineNodes = chats.some(chat => chat.branchTree &&
    Object.values(chat.branchTree.nodes).some(node => 'content' in node && !node.contentHash));
  const version = hasInlineNodes ? 2 : isRecord(state.contentStore) ? 3 : 1;
  if (version === 3 || hasInlineNodes) {
    const hashedChats = hasInlineNodes ? chats.map(chat => chat.branchTree ? {
      ...chat, branchTree: { ...chat.branchTree, nodes: Object.fromEntries(
        Object.entries(chat.branchTree.nodes).filter(([, node]) => node.contentHash !== undefined),
      ) },
    } : chat) : chats;
    const errors = findPersistedDataIntegrityErrors(hashedChats, (state.contentStore ?? {}) as ContentStoreData, null);
    if (errors.length) throw new Error(`Invalid legacy remote snapshot: ${errors.join('; ')}`);
  }
  for (const chat of chats) {
    if (hasInlineNodes && chat.branchTree) {
      for (const node of Object.values(chat.branchTree.nodes)) {
        if (node.contentHash) {
          (node as unknown as BranchNodeLegacy).content = resolveContent(state.contentStore as ContentStoreData, node.contentHash);
          delete (node as Partial<typeof node>).contentHash;
        }
      }
    }
    if (chat.messages === undefined) {
      if (!chat.branchTree) throw new Error('Invalid legacy remote snapshot: missing chat messages');
      chat.messages = version === 3 ? materializeActivePath(chat.branchTree, state.contentStore as ContentStoreData) : [];
    }
  }
  return { ...state, version, chats, folders: state.folders ?? {} };
};

export const detectImportType = (parsedData: unknown): ImportType => {
  // Check versioned exports first — they are the most specific (have a
  // numeric `version` field) and must not be swallowed by the broader
  // OpenAI / legacy checks that follow.
  if (isRecord(parsedData) && parsedData.version === 3) return 'ExportV3';
  if (isRecord(parsedData) && parsedData.version === 2) return 'ExportV2';
  if (isRecord(parsedData) && parsedData.version === 1) return 'ExportV1';
  if (isOpenAIContent(parsedData)) return 'OpenAIContent';
  if (isLegacyImport(parsedData)) return 'LegacyImport';
  if (isSingleChatImport(parsedData)) return 'SingleChat';
  return '';
};

export const buildSuccessResult = (message: string): ImportResult => ({
  success: true,
  message,
});

export const buildFailureResult = (message: string): ImportResult => ({
  success: false,
  message,
});

const importLegacyChats = (
  plan: StoreState,
  chatsToImport: unknown[],
  t: Translator
): ImportResult => {
  if (!validateAndFixChats(chatsToImport)) {
    return buildFailureResult(
      t('notifications.invalidChatsDataFormat', { ns: 'import' })
    );
  }

  const folderNameToIdMap: Record<string, string> = {};
  const parsedFolders: string[] = [];

  chatsToImport.forEach((chat) => {
    const folder = chat.folder;
    if (!folder) return;
    if (!parsedFolders.includes(folder)) {
      parsedFolders.push(folder);
      folderNameToIdMap[folder] = uuidv4();
    }
    chat.folder = folderNameToIdMap[folder];
  });

  const newFolders: FolderCollection = parsedFolders.reduce((acc, folderName, index) => {
    const id = folderNameToIdMap[folderName];
    const nextFolder: Folder = {
      id,
      name: folderName,
      expanded: false,
      order: index,
    };
    return { [id]: nextFolder, ...acc };
  }, {} as FolderCollection);

  shiftAndMergeFolders(plan, newFolders);

  const contentStore = { ...plan.contentStore };
  for (const chat of chatsToImport) {
    if (!chat.branchTree) {
      flatChatToBranchTree(chat, contentStore);
    }
  }
  plan.contentStore = contentStore;

  mergeChats(plan, chatsToImport);

  return chatsToImport.length > 0
    ? buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }))
    : buildFailureResult(t('notifications.nothingImported', { ns: 'import' }));
};

export const mergeImportedContent = (plan: StoreState, chats: ChatInterface[], importedContentStore: ContentStoreData) => {
  const existingContentStore = new Map(Object.entries(plan.contentStore)
    .map(([hash, entry]) => [hash, { ...entry }]));
  const importedEntries = Object.entries(importedContentStore);
  const reservedHashes = new Set([...existingContentStore.keys(), ...Object.keys(importedContentStore)]);
  // Missing references must stay missing rather than bind to a newly allocated alias.
  for (const entry of [...existingContentStore.values(), ...Object.values(importedContentStore)]) {
    if (entry.delta) reservedHashes.add(entry.delta.baseHash);
  }
  for (const chat of [...plan.chats ?? [], ...chats]) {
    for (const node of Object.values(chat.branchTree?.nodes ?? {})) reservedHashes.add(node.contentHash);
  }
  for (const node of Object.values(plan.branchClipboard?.nodes ?? {})) reservedHashes.add(node.contentHash);
  const hashMap = new Map<string, string>();
  const reserveHash = (hash: string) => {
    let target = hash;
    do { target += '_'; } while (reservedHashes.has(target));
    reservedHashes.add(target);
    hashMap.set(hash, target);
  };
  for (const [hash, entry] of importedEntries) {
    const existing = existingContentStore.get(hash);
    if (existing && JSON.stringify({ ...existing, refCount: 0 }) !== JSON.stringify({ ...entry, refCount: 0 })) {
      reserveHash(hash);
    }
  }
  // A reused delta also needs a new hash if its imported base was remapped.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [hash, entry] of importedEntries) {
      if (entry.delta && hashMap.has(entry.delta.baseHash) && !hashMap.has(hash) && existingContentStore.has(hash)) {
        reserveHash(hash);
        changed = true;
      }
    }
  }
  for (const [hash, entry] of importedEntries) {
    const target = hashMap.get(hash) ?? hash;
    const imported = deepClone(entry);
    if (imported.delta) {
      imported.delta.baseHash = hashMap.get(imported.delta.baseHash) ?? imported.delta.baseHash;
    }
    const existing = existingContentStore.get(target);
    existingContentStore.set(target, existing
      ? { ...existing, refCount: existing.refCount + imported.refCount }
      : imported);
  }
  for (const chat of chats) {
    for (const node of Object.values(chat.branchTree?.nodes ?? {})) {
      node.contentHash = hashMap.get(node.contentHash) ?? node.contentHash;
    }
  }
  plan.contentStore = Object.fromEntries(existingContentStore);
};

const importExportV3 = (
  plan: StoreState,
  parsedData: ExportV3,
  t: Translator,
  mode: ImportMode,
  includeSettings: boolean
): ImportResult => {
  if (!validateExportV3(parsedData)) {
    return buildFailureResult(
      t('notifications.invalidFormatForVersion', { ns: 'import' })
    );
  }
  const chats = parsedData.chats ?? [];

  clearMissingFolderReferences(chats, parsedData.folders);

  shiftAndMergeFolders(plan, parsedData.folders);

  mergeImportedContent(plan, chats, parsedData.contentStore as ContentStoreData);
  const chatIdMap = mergeChats(plan, chats);

  if (parsedData.evaluationResults) {
    const remapped = remapEvaluationResultKeys(parsedData.evaluationResults, chatIdMap);
    const existingResults = plan.evaluationResults;
    plan.evaluationResults = { ...existingResults, ...remapped };
  }

  if (includeSettings && mode === 'replace' && parsedData.evaluationSettings) {
    // Backfill defaults for fields added after initial release
    const currentDefaults = plan.evaluationSettings;
    plan.evaluationSettings = { ...currentDefaults, ...parsedData.evaluationSettings };
  }

  return chats.length > 0 || Object.keys(parsedData.folders).length > 0
    ? buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }))
    : buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' }));
};

const importExportV2 = (plan: StoreState, parsedData: ExportV2, t: Translator): ImportResult => {
  if (!validateExportV2(parsedData)) {
    return buildFailureResult(
      t('notifications.invalidFormatForVersion', { ns: 'import' })
    );
  }

  clearMissingFolderReferences(parsedData.chats, parsedData.folders);
  shiftAndMergeFolders(plan, parsedData.folders);

  const contentStore = { ...plan.contentStore };
  if (parsedData.chats) {
    type LegacyBranchNodeWithHash = Omit<BranchNodeLegacy, 'content'> & {
      content?: BranchNodeLegacy['content'];
      contentHash?: string;
    };
    for (const chat of parsedData.chats) {
      if (chat.branchTree) {
        for (const node of Object.values(chat.branchTree.nodes) as LegacyBranchNodeWithHash[]) {
          if (node.content && !node.contentHash) {
            node.contentHash = addContent(contentStore, node.content);
            delete node.content;
          }
        }
      } else {
        flatChatToBranchTree(chat, contentStore);
      }
    }
  }

  plan.contentStore = contentStore;
  if (parsedData.chats) {
    mergeChats(plan, parsedData.chats);
  }

  return (parsedData.chats && parsedData.chats.length > 0) || Object.keys(parsedData.folders).length > 0
    ? buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }))
    : buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' }));
};

const importExportV1 = (
  plan: StoreState,
  parsedData: ExportV1,
  t: Translator
): ImportResult => {
  if (!validateExportV1(parsedData)) {
    return buildFailureResult(
      t('notifications.invalidFormatForVersion', { ns: 'import' })
    );
  }

  clearMissingFolderReferences(parsedData.chats, parsedData.folders);
  shiftAndMergeFolders(plan, parsedData.folders);

  if (parsedData.chats) {
    const contentStore = { ...plan.contentStore };
    for (const chat of parsedData.chats) {
      if (!chat.branchTree) {
        flatChatToBranchTree(chat, contentStore);
      }
    }
    plan.contentStore = contentStore;
    mergeChats(plan, parsedData.chats);
  }

  return (parsedData.chats && parsedData.chats.length > 0) || Object.keys(parsedData.folders).length > 0
    ? buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }))
    : buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' }));
};

const importOpenAIData = (
  plan: StoreState,
  chatsToImport: OpenAIChat | OpenAIPlaygroundJSON | OpenAIChat[],
  shouldAllowPartialImport: boolean,
  t: Translator
): ImportResult => {
  const chats = importOpenAIChatExport(chatsToImport, shouldAllowPartialImport);

  const contentStore = { ...plan.contentStore };
  for (const chat of chats) {
    if (!chat.branchTree) {
      flatChatToBranchTree(chat, contentStore);
    }
  }
  plan.contentStore = contentStore;

  mergeChats(plan, chats);

  return chats.length > 0
    ? buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }))
    : buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' }));
};

// Validate both directed graphs before the legacy converter traverses/backtracks them.
const validateOpenAIMappings = (data: unknown) => {
  for (const chat of Array.isArray(data) ? data : [data]) {
    if (!isRecord(chat) || !Object.hasOwn(chat, 'mapping')) continue; // Playground has flat messages.
    if (!isRecord(chat.mapping) || Array.isArray(chat.mapping)) throw new Error('Invalid OpenAI mapping');
    const mapping = chat.mapping;
    const ids = Object.keys(mapping);
    if (!ids.length) throw new Error('Empty OpenAI mapping');
    if (chat.current_node !== undefined && chat.current_node !== null &&
        (typeof chat.current_node !== 'string' || !Object.hasOwn(mapping, chat.current_node))) {
      throw new Error('Invalid OpenAI current_node');
    }
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    for (const id of ids) {
      const node = mapping[id];
      if (!isRecord(node) || node.id !== id || !Array.isArray(node.children) ||
          (node.parent !== null && (typeof node.parent !== 'string' || !Object.hasOwn(mapping, node.parent))) ||
          node.children.some(child => typeof child !== 'string' || !Object.hasOwn(mapping, child))) {
        throw new Error('Invalid OpenAI node references');
      }
      // The converter continues without advancing its parent for unsupported roles.
      if (isRecord(node.message) && isRecord(node.message.author) &&
          !['user', 'assistant', 'system'].includes(String(node.message.author.role))) {
        throw new Error('Unsupported OpenAI message role');
      }
      parents.set(id, node.parent === null ? [] : [node.parent as string]);
      children.set(id, node.children as string[]);
    }
    for (const edges of [parents, children]) {
      const indegrees = new Map(ids.map(id => [id, 0]));
      for (const targets of edges.values()) for (const target of targets) indegrees.set(target, indegrees.get(target)! + 1);
      const queue = ids.filter(id => indegrees.get(id) === 0);
      for (let index = 0; index < queue.length; index++) {
        for (const target of edges.get(queue[index])!) {
          indegrees.set(target, indegrees.get(target)! - 1);
          if (indegrees.get(target) === 0) queue.push(target);
        }
      }
      if (queue.length !== ids.length) throw new Error('Circular OpenAI mapping');
    }
  }
};

// Runtime view references use positions; keep their existing chat identities after prepend.
export const importParsedData = (
  base: StoreState,
  parsedData: unknown,
  type: ImportType,
  t: Translator,
  shouldAllowPartialImport: boolean,
  mode: ImportMode,
  includeSettings: boolean = true,
  initial: StoreState = base,
  decisions: ImportDecisions = {},
  resolveDecision?: (decision:ImportDecision)=>boolean
): { result: ImportResult; plan: StoreState; removedChatsCount?: number; decision?: ImportDecision } => {
  if (type === 'OpenAIContent') validateOpenAIMappings(parsedData);
  let chatsToImport = parsedData;
  let removedChatsCount = 0;
  let reduceImport = decisions.reduceImport === true;
  shouldAllowPartialImport ||= decisions.allowPartialImport === true;

  while (true) {
    const plan = createImportPlan(base, mode, includeSettings, initial);
    try {
      // Each retry converts a fresh payload so ids, folders and refs cannot accumulate.
      const data = deepClone(chatsToImport);
      let result: ImportResult;
      switch (type) {
        case 'OpenAIContent':
          result = importOpenAIData(plan, data as OpenAIChat | OpenAIPlaygroundJSON | OpenAIChat[],
            shouldAllowPartialImport, t);
          break;
        case 'SingleChat':
          result = importLegacyChats(plan, [data], t);
          break;
        case 'LegacyImport':
          result = importLegacyChats(plan, data as unknown[], t);
          break;
        case 'ExportV3':
          result = importExportV3(plan, data as ExportV3, t, mode, includeSettings);
          break;
        case 'ExportV2':
          result = importExportV2(plan, data as ExportV2, t);
          break;
        case 'ExportV1':
          result = importExportV1(plan, data as ExportV1, t);
          break;
        default:
          result = buildFailureResult(t('notifications.unrecognisedDataFormat', { ns: 'import' }));
      }
      return { result, plan, removedChatsCount };
    } catch (error: unknown) {
      if ((error as DOMException).name === 'QuotaExceededError') {
        const chats = type === 'ExportV1' && isRecord(chatsToImport)
          ? chatsToImport.chats : chatsToImport;
        if (!Array.isArray(chats) || !chats.length) {
          return { result: buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' })), plan };
        }
        if (reduceImport) {
          chats.pop();
          removedChatsCount++;
          continue;
        }
        if (decisions.reduceImport === undefined && resolveDecision) decisions.reduceImport=resolveDecision({kind:'reduce-import',message:t('reduceMessagesFailedImportWarning')});
        if (decisions.reduceImport === undefined) return {result:buildFailureResult(t('reduceMessagesFailedImportWarning')),plan,decision:{kind:'reduce-import',message:t('reduceMessagesFailedImportWarning')}};
        if (decisions.reduceImport) {
          reduceImport = true;
          continue;
        }
        return { result: buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' })), plan };
      }
      if (error instanceof PartialImportError) {
        if (decisions.allowPartialImport === undefined && resolveDecision) decisions.allowPartialImport=resolveDecision({kind:'partial-import',message:error.message});
        if (decisions.allowPartialImport === undefined) return {result:buildFailureResult(error.message),plan,decision:{kind:'partial-import',message:error.message}};
        if (decisions.allowPartialImport) {
          shouldAllowPartialImport = true;
          reduceImport = true;
          continue;
        }
        return { result: buildFailureResult(t('notifications.nothingImported', { ns: 'import' })), plan };
      }
      return { result: buildFailureResult((error as Error).message), plan };
    }
  }
};

export type ImportPreviewSource = {
  chats: ChatInterface[];
  folders: FolderCollection;
  contentStore: ContentStoreData;
  evaluationResults: EvaluationResultMap;
  recoveredContentCount?: number;
  unavailableContent?: Record<string, string[]>;
  evaluationSettings?: ExportV3['evaluationSettings'];
  extensions?: Record<string,unknown>;
};

type PreviewChat = ChatInterface & { __previewMissingContent?: string[] };

// Repair only the detached file data. Missing bodies stay explicit and cannot be imported.
const prepareMissingPreviewContent = (chats: unknown[], store: ContentStoreData, t: Translator) => {
  const originalHashes = new Set(Object.keys(store));
  const retained = new Map<string, ContentStoreData[string]['content'] | null>();
  const references: { chat: Record<string, unknown>; node: Record<string, unknown>; hash: string }[] = [];
  let recovered = 0;
  const asContent = (value: unknown) => {
    const content = typeof value === 'string' ? [{ type: 'text', text: value }] : value;
    return validateExportV3({ version: 3, chats: [], folders: {},
      contentStore: { candidate: { content, refCount: 1 } } } as ExportV3)
      ? content as ContentStoreData[string]['content'] : undefined;
  };
  for (const value of chats) {
    if (!isRecord(value)) continue;
    delete value.__previewMissingContent;
    const tree = value.branchTree;
    if (!isRecord(tree) || !isRecord(tree.nodes)) continue;
    for (const node of Object.values(tree.nodes)) {
      if (!isRecord(node) || typeof node.contentHash !== 'string' ||
          originalHashes.has(node.contentHash) || isStreamingContentHash(node.contentHash)) continue;
      const hash = node.contentHash;
      let content = asContent(node.content);
      const path = tree.activePath;
      const messages = value.messages;
      if (!content && Array.isArray(path) && Array.isArray(messages) && path.length === messages.length) {
        const message = messages[path.indexOf(node.id)];
        if (isRecord(message) && message.role === node.role) {
          const candidate = asContent(message.content);
          if (candidate) {
            const candidateHash = computeContentHash(candidate);
            // Suffixes distinguish collisions; never trust a stale positional message alone.
            if (hash === candidateHash || (hash.startsWith(candidateHash) && /^_+$/.test(hash.slice(candidateHash.length)))) content = candidate;
          }
        }
      }
      references.push({ chat: value, node, hash });
      if (content) {
        const previous = retained.get(hash);
        retained.set(hash, previous === undefined ? content
          : JSON.stringify(previous) === JSON.stringify(content) ? previous : null);
      }
    }
  }
  for (const { chat, node, hash } of references) {
    let content = retained.get(hash);
    if (content) recovered++;
    else {
      const missing = (chat.__previewMissingContent ??= []) as string[];
      missing.push(hash);
      content = [{ type: 'text', text: t('preview.missingContent', { ns: 'import', hash }) }];
    }
    node.contentHash = addContent(store, content);
    delete node.content;
  }
  return recovered;
};

export const validatePreviewSource = (source: ImportPreviewSource) => {
  if (!validateFolders(source.folders)) throw new Error('Invalid folder hierarchy');
  const errors = findPersistedDataIntegrityErrors(source.chats, source.contentStore, null);
  if (errors.length) throw new Error(errors.join('; '));
  for (const [hash, entry] of Object.entries(source.contentStore)) {
    if (isStreamingContentHash(hash) || (entry.delta && isStreamingContentHash(entry.delta.baseHash))) {
      throw new Error('Streaming content cannot be previewed');
    }
  }
  if (validateDeltaIntegrity(source.contentStore).size) throw new Error('Invalid delta content');
  for (const chat of source.chats) {
    const tree = chat.branchTree;
    if (!tree) continue;
    const ids = Object.keys(tree.nodes);
    if (!Array.isArray(tree.activePath) || (ids.length && !tree.nodes[tree.rootId])) {
      throw new Error('Invalid branch root or active path');
    }
    const checked = new Set<string>();
    for (const id of ids) {
      const node = tree.nodes[id];
      if (!node || node.id !== id || !['user', 'assistant', 'system'].includes(node.role) ||
          (node.parentId !== null && !tree.nodes[node.parentId])) throw new Error('Invalid branch node');
      const path = new Set<string>();
      let current: string | null = id;
      while (current !== null && !checked.has(current)) {
        if (path.has(current)) throw new Error('Circular branch tree');
        path.add(current);
        current = tree.nodes[current].parentId;
      }
      path.forEach(value => checked.add(value));
      const content = resolveContent(source.contentStore, node.contentHash);
      // Use the existing content validation for resolved deltas as well.
      if (!validateExportV3({ version: 3, chats: [], folders: {},
        contentStore: { resolved: { content, refCount: 1 } } })) throw new Error('Invalid resolved content');
    }
    const activeIds = new Set<string>();
    let previous: string | null = null;
    for (const id of tree.activePath) {
      if (!tree.nodes[id] || activeIds.has(id) || tree.nodes[id].parentId !== previous) {
        throw new Error('Invalid active path');
      }
      activeIds.add(id);
      previous = id;
    }
  }
};

/** Converts into a detached plan; no persistence, AI cancellation or live state changes. */
export const prepareImportData = (data: unknown, base: StoreState, t: Translator, decisions: ImportDecisions = {}, resolveDecision?: (decision:ImportDecision)=>boolean, allowEmpty=false) => {
  const raw = normalizeLegacyIOSImport(deepClone(data));
  const payload = isRecord(raw) && isRecord(raw.state) ? raw.state : raw;
  // Reject transient hashes before any converter can resolve the live streaming buffer.
  const rawChats = isRecord(payload) && Array.isArray(payload.chats) ? payload.chats
    : Array.isArray(payload) ? payload : [payload];
  let recoveredContentCount = 0;
  if (isRecord(payload) && isRecord(payload.contentStore)) {
    const contentStore = payload.contentStore as unknown as ContentStoreData;
    if (!validateExportV3({ version: 3, chats: [], folders: {}, contentStore })) throw new Error('Invalid content store');
    for (const [hash, entry] of Object.entries(contentStore)) {
      if (isStreamingContentHash(hash) || (entry?.delta && isStreamingContentHash(entry.delta.baseHash))) {
        throw new Error('Streaming content cannot be previewed');
      }
    }
    if (validateDeltaIntegrity(contentStore).size) throw new Error('Invalid delta content');
    recoveredContentCount = prepareMissingPreviewContent(rawChats, contentStore, t);
    const hashedChats = rawChats.map(chat => isRecord(chat) && isRecord(chat.branchTree) && isRecord(chat.branchTree.nodes)
      ? { ...chat, branchTree: { ...chat.branchTree, nodes: Object.fromEntries(
          Object.entries(chat.branchTree.nodes).filter(([, node]) => isRecord(node) && node.contentHash !== undefined),
        ) } } : chat);
    const errors = findPersistedDataIntegrityErrors(hashedChats as ChatInterface[], contentStore, null)
      .filter(error => !error.startsWith('Duplicate chat id:'));
    if (errors.length) throw new Error(errors.join('; '));
  }
  for (const chat of rawChats) {
    if (isRecord(chat) && isRecord(chat.branchTree) && isRecord(chat.branchTree.nodes)) {
      for (const node of Object.values(chat.branchTree.nodes)) {
        if (isRecord(node) && typeof node.contentHash === 'string' && isStreamingContentHash(node.contentHash)) {
          throw new Error('Streaming content cannot be previewed');
        }
      }
    }
  }
  const parsed = isRecord(raw) && Object.hasOwn(raw, 'state') && typeof raw.version === 'number'
    ? decodeLegacyRemoteImport(raw as unknown as LegacyRemoteSnapshot) : raw;
  const type = detectImportType(parsed);
  if (!type) throw new Error(t('notifications.unrecognisedDataFormat', { ns: 'import' }));
  const { result, plan, decision } = importParsedData(base, parsed, type, t, false, 'replace', false, base, decisions, resolveDecision);
  if (decision) return {status:'decision-required' as const,decision,result};
  const validEmpty=allowEmpty && !(plan.chats?.length) && !Object.keys(plan.folders).length && (type==='ExportV3'?validateExportV3(parsed as ExportV3):type==='ExportV2'?validateExportV2(parsed as ExportV2):type==='ExportV1'?validateExportV1(parsed as ExportV1):false);
  if (!result.success && !validEmpty) return {status:'failed' as const,result};
  const source = previewSourceFromPlan(plan);
  if (isRecord(parsed) && type.startsWith('Export')) {
    source.extensions=Object.fromEntries(Object.entries(parsed).filter(([key])=>!['version','chats','folders','contentStore','evaluationSettings','evaluationResults'].includes(key)));
    if ('evaluationSettings' in parsed) source.evaluationSettings=deepClone(parsed.evaluationSettings as ExportV3['evaluationSettings']);
  }
  source.recoveredContentCount = recoveredContentCount;
  source.unavailableContent = {};
  for (const chat of source.chats as PreviewChat[]) {
    if (chat.__previewMissingContent?.length) source.unavailableContent[chat.id] = chat.__previewMissingContent;
    delete chat.__previewMissingContent;
  }
  validatePreviewSource(source);
  return {status:'ready' as const,source,type};
};

export type ImportPreviewSelectionOptions = {
  fileName: string;
  selectedFolderIds: readonly string[];
};

export const previewSourceFromPlan = (plan: StoreState): ImportPreviewSource => {
  // V3 also permits legacy flat chats; normalize before mounting reused views.
  for (const chat of plan.chats ?? []) {
    if (!chat.branchTree) flatChatToBranchTree(chat, plan.contentStore);
  }
  const source: ImportPreviewSource = { chats: plan.chats ?? [], folders: plan.folders,
    contentStore: plan.contentStore, evaluationResults: plan.evaluationResults ?? {} };
  return source;
};

export const validateImportSelection=(source:ImportPreviewSource,ids:readonly string[],t:Translator,options:ImportPreviewSelectionOptions,completeFileImport=false)=>{
  if (!completeFileImport) validatePreviewSource(source);
  const selectedIds = new Set(ids);
  const selected = source.chats.filter(chat => selectedIds.has(chat.id));
  if (selected.some(chat => source.unavailableContent?.[chat.id]?.length)) {
    throw new Error(t('preview.cannotImportMissingContent', { ns: 'import' }));
  }
  const includedFolderIds = new Set(options.selectedFolderIds);
  if (selected.length !== selectedIds.size || [...includedFolderIds].some(id => !Object.hasOwn(source.folders, id))) {
    throw new Error(t('notifications.nothingImported', { ns: 'import' }));
  }
  for (const chat of selected) if (chat.folder) includedFolderIds.add(chat.folder);
  // Only ancestor closure; unchecked chats and unrelated descendants remain excluded.
  for (const id of includedFolderIds) {
    const parentId = source.folders[id]?.parentId;
    if (parentId) includedFolderIds.add(parentId);
  }
  if (!selected.length && !includedFolderIds.size) {
    throw new Error(t('notifications.nothingImported', { ns: 'import' }));
  }
  return {selectedIds,selected,includedFolderIds};
};

/** Shared by full file append and preview selection; source ids never merge with live ids. */
export const buildPreviewAppendPatch = (
  base: StoreState, source: ImportPreviewSource, ids: readonly string[], t: Translator,
  options: ImportPreviewSelectionOptions, completeFileImport = false, currentChatId?: string
) => {
  const {selectedIds,selected,includedFolderIds}=validateImportSelection(source,ids,t,options,completeFileImport);
  const rootId = uuidv4();
  const folderIdMap = Object.fromEntries([...includedFolderIds].map(id => [id, uuidv4()]));
  const folders = { ...base.folders };
  // A new root shifts only its root siblings, preserving each child's order and reference.
  for (const [id, folder] of Object.entries(folders)) {
    if (!folder.parentId) folders[id] = { ...folder, order: folder.order + 1 };
  }
  folders[rootId] = { id: rootId,
    name: t('preview.importFolderName', { fileName: options.fileName, ns: 'import', defaultValue: 'Import: {{fileName}}' }),
    expanded: true, order: 0 };
  for (const id of includedFolderIds) {
    const folder = source.folders[id];
    const nextId = folderIdMap[id];
    folders[nextId] = { ...deepClone(folder), id: nextId,
      parentId: folder.parentId ? folderIdMap[folder.parentId] : rootId };
  }
  const plan = { ...base, contentStore: deepClone(base.contentStore ?? {}) };
  const chatIdMap: Record<string, string> = {};
  const chats = selected.map(original => {
    const prepared = completeFileImport ? undefined : prepareChatForExport(original, source.contentStore);
    const chat = prepared?.chat ?? deepClone(original);
    assignFreshChatIds([chat]);
    chatIdMap[original.id] = chat.id;
    chat.folder = original.folder ? folderIdMap[original.folder] : rootId;
    chat.messages = completeFileImport
      ? chat.messages.map(({ role, content }) => ({ role, content }))
      : materializeActivePath(chat.branchTree!, source.contentStore);
    if (prepared) mergeImportedContent(plan, [chat], prepared.contentStore);
    return chat;
  });
  if (completeFileImport) mergeImportedContent(plan, chats, source.contentStore);
  const contentStore = plan.contentStore;
  const evaluationResults = Object.fromEntries(Object.entries(source.evaluationResults)
    .filter(([key]) => selectedIds.has(key.slice(0, key.indexOf(':')))));
  const selectedChatId = currentChatId;
  const mergedChats = [...chats, ...(base.chats ?? [])];
  return {
    chats: mergedChats, folders, contentStore,
    evaluationResults: { ...base.evaluationResults, ...remapEvaluationResultKeys(evaluationResults, chatIdMap) },
    currentChatIndex: selectedChatId ? mergedChats.findIndex(chat => chat.id === selectedChatId)
      : mergedChats.length ? 0 : -1,
  };
};

