import { v4 as uuidv4 } from 'uuid';
import { showToast } from '@utils/showToast';

import useStore from '@store/store';
import { createPartializedState } from '@store/store';
import type { StoreState } from '@store/store';
import { createPersistedChatDataState } from '@store/persistence';
import { STORE_VERSION } from '@store/version';
import { findPersistedDataIntegrityErrors } from '@store/storage/prepareSave';
import { saveChatData, resolveLegacyRemoteSnapshot, type LegacyRemoteSnapshot } from '@store/storage/IndexedDbStorage';
import { setLocalStorageItem } from '@store/storage/storageErrors';
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
import { flatMessagesToBranchTree, materializeActivePath } from '@utils/branchUtils';
import { assignFreshChatIds } from '@utils/chatIdentity';
import { ContentStoreData, addContent, computeContentHash, resolveContent, validateDeltaIntegrity } from '@utils/contentStore';
import { prepareChatForExport } from '@utils/chatExport';
import { isStreamingContentHash } from '@utils/streamingBuffer';
import { normalizeSystemPrompt } from '@utils/systemPromptNormalize';
import { isKnownModel } from '@utils/modelLookup';
import { BranchNodeLegacy, ChatInterface, Folder, FolderCollection } from '@type/chat';
import { ExportV1, ExportV2, ExportV3, OpenAIChat, OpenAIPlaygroundJSON } from '@type/export';
import type { EvaluationResultMap } from '@type/evaluation';
import { invalidateAiTasks } from '@hooks/aiTaskLifetime';

export type ImportResult = {
  success: boolean;
  message: string;
  status?: 'concurrent-change' | 'storage-error';
};

export type ImportMode = 'append' | 'replace';

type Translator = (key: string, opts?: Record<string, unknown>) => string;
type ImportType =
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
const snapshot = (state: StoreState) => deepClone(createPartializedState({
  ...state, contentStore: deepClone(state.contentStore),
}));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const extractModelId = (chat: unknown): string | undefined => {
  if (!isRecord(chat) || !isRecord(chat.config) || typeof chat.config.model !== 'string') {
    return undefined;
  }
  return chat.config.model;
};

// Only persisted data is cloned; store actions and runtime state remain on the base.
const createImportPlan = (base: StoreState, mode: ImportMode, includeSettings: boolean): StoreState => {
  const defaults = mode === 'replace' && includeSettings
    ? snapshot(useStore.getInitialState())
    : snapshot(base);
  return {
    ...base,
    ...defaults,
    chats: mode === 'replace' ? [] : deepClone(base.chats),
    folders: mode === 'replace' ? {} : deepClone(base.folders),
    contentStore: mode === 'replace' ? {} : deepClone(base.contentStore),
    branchClipboard: mode === 'replace' ? null : deepClone(base.branchClipboard),
    currentChatIndex: mode === 'replace' ? -1 : base.currentChatIndex,
    evaluationResults: mode === 'replace' ? {} : deepClone(base.evaluationResults),
  };
};

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

const warnUnsupportedModels = (chats: unknown[], t: Translator) => {
  const unsupportedModels = Array.from(
    new Set(
      chats
        .map(extractModelId)
        .filter((id: string | undefined) => id && !isKnownModel(id))
    )
  );

  if (unsupportedModels.length === 0) return false;

  showToast(
    t('notifications.unsupportedModels', {
      ns: 'import',
      models: unsupportedModels.join(', '),
    }) ||
      `Unsupported model(s): ${unsupportedModels.join(', ')}. Please add them in AI Provider Settings → Custom tab before importing.`,
    'warning',
    15000
  );
  return true;
};

export const readImportFile = async (file: File): Promise<string> => {
  if (file.name.endsWith('.gz') && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const decompressedStream = file.stream().pipeThrough(ds);
    return await new Response(decompressedStream).text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Import file read failed'));
    reader.onabort = () => reject(new Error('Import file read aborted'));
    reader.readAsText(file);
  });
};

// Raw sync backups enter the existing import converters only by explicit file import.
const decodeLegacyRemoteImport = (raw: LegacyRemoteSnapshot) => {
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

const detectImportType = (parsedData: unknown): ImportType => {
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

const buildSuccessResult = (message: string): ImportResult => ({
  success: true,
  message,
});

const buildFailureResult = (message: string): ImportResult => ({
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
      chat.branchTree = flatMessagesToBranchTree(chat.messages, contentStore);
    }
  }
  plan.contentStore = contentStore;

  mergeChats(plan, chatsToImport);

  return chatsToImport.length > 0
    ? buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }))
    : buildFailureResult(t('notifications.nothingImported', { ns: 'import' }));
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

  const existingContentStore = { ...plan.contentStore };
  const importedContentStore = parsedData.contentStore as ContentStoreData;
  for (const [hash, entry] of Object.entries(importedContentStore)) {
    if (existingContentStore[hash]) {
      existingContentStore[hash].refCount += entry.refCount;
    } else {
      existingContentStore[hash] = { ...entry };
    }
  }
  plan.contentStore = existingContentStore;
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
        chat.branchTree = flatMessagesToBranchTree(chat.messages, contentStore);
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
        chat.branchTree = flatMessagesToBranchTree(chat.messages, contentStore);
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
      chat.branchTree = flatMessagesToBranchTree(chat.messages, contentStore);
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
const remapAppendedChatReferences = (base: StoreState, chats: ChatInterface[]) => {
  const positions = new Map(chats.map((chat, index) => [chat.id, index]));
  const remap = (index: number | null) => index === null ? null
    : positions.get(base.chats?.[index]?.id ?? '') ?? null;
  const focus = (value: StoreState['pendingChatFocus']) => {
    if (!value) return null;
    const chatIndex = remap(value.chatIndex);
    return chatIndex === null ? null : { ...value, chatIndex };
  };
  return {
    multiViewChatIndices: (base.multiViewChatIndices ?? []).flatMap(index => {
      const next = remap(index);
      return next === null ? [] : [next];
    }),
    multiViewPrimaryChatIndex: remap(base.multiViewPrimaryChatIndex ?? null),
    pendingChatFocus: focus(base.pendingChatFocus),
    compareTarget: focus(base.compareTarget),
  };
};

const importParsedData = async (
  base: StoreState,
  parsedData: unknown,
  type: ImportType,
  t: Translator,
  shouldAllowPartialImport: boolean,
  mode: ImportMode,
  includeSettings: boolean = true
): Promise<{ result: ImportResult; plan: StoreState; removedChatsCount?: number }> => {
  if (type === 'OpenAIContent') validateOpenAIMappings(parsedData);
  let chatsToImport = parsedData;
  let removedChatsCount = 0;
  let reduceImport = false;

  while (true) {
    const plan = createImportPlan(base, mode, includeSettings);
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
        if (window.confirm(t('reduceMessagesFailedImportWarning'))) {
          reduceImport = true;
          continue;
        }
        return { result: buildFailureResult(t('notifications.quotaExceeded', { ns: 'import' })), plan };
      }
      if (error instanceof PartialImportError) {
        if (window.confirm(t('partialImportWarning', { message: error.message }))) {
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

export const importChatFromFile = async (
  file: File,
  t: Translator,
  mode: ImportMode = 'append',
  includeSettings: boolean = true
): Promise<ImportResult> => {
  let committed = false;
  try {
    const data = await readImportFile(file);
    const raw = JSON.parse(data);
    const legacyRemote = isRecord(raw) && Object.hasOwn(raw, 'state') && typeof raw.version === 'number'
      ? raw as unknown as LegacyRemoteSnapshot : undefined;
    const parsedData = legacyRemote ? decodeLegacyRemoteImport(legacyRemote) : raw;
    const originalImport = deepClone(parsedData);
    const type = detectImportType(parsedData);
    if (!type) return buildFailureResult(t('notifications.unrecognisedDataFormat', { ns: 'import' }));
    const valid = type === 'ExportV3' ? validateExportV3(parsedData)
      : type === 'ExportV2' ? validateExportV2(parsedData)
      : type === 'ExportV1' ? validateExportV1(parsedData)
      : type === 'LegacyImport' ? validateAndFixChats(parsedData)
      : type === 'SingleChat' ? validateAndFixChats([parsedData]) : true;
    if (!valid) {
      if (type === 'LegacyImport' || type === 'SingleChat') warnUnsupportedModels(type === 'LegacyImport' ? parsedData : [parsedData], t);
      return buildFailureResult(t(type.startsWith('Export')
        ? 'notifications.invalidFormatForVersion' : 'notifications.invalidChatsDataFormat', { ns: 'import' }));
    }
    if (mode === 'replace') invalidateAiTasks();
    const base = useStore.getState();
    const observed = JSON.stringify(snapshot(base));
    const { result, plan, removedChatsCount } = await importParsedData(base, parsedData, type, t, false,
      mode === 'append' ? 'replace' : mode, mode === 'append' ? false : includeSettings);
    if (!result.success) return result;
    if (useStore.getState() !== base || JSON.stringify(snapshot(useStore.getState())) !== observed) {
      return { success: false, message: 'concurrent-change', status: 'concurrent-change' };
    }
    const chats = plan.chats ?? [];
    const patch = mode === 'append'
      ? buildPreviewAppendPatch(base, previewSourceFromPlan(plan), chats.map(chat => chat.id), t, {
          fileName: file.name, selectedFolderIds: Object.keys(plan.folders),
        })
      : {
          ...createPartializedState(plan), chats, contentStore: plan.contentStore,
          branchClipboard: plan.branchClipboard,
          currentChatIndex: chats.length ? 0 : -1,
          ...chatNodeMaps(chats), branchHistoryPast: [], branchHistoryFuture: [],
        };
    committed = true;
    useStore.setState(patch);
    setLocalStorageItem('currentChatIndex', String(patch.currentChatIndex));
    await saveChatData(createPersistedChatDataState({
      ...useStore.getState(), contentStore: deepClone(useStore.getState().contentStore),
    }));
    if (legacyRemote && !removedChatsCount) {
      await resolveLegacyRemoteSnapshot(legacyRemote);
      await useStore.getState().refreshLegacyRemoteMigration();
    }
    if (type === 'LegacyImport' || type === 'SingleChat') warnUnsupportedModels(type === 'LegacyImport' ? parsedData : [parsedData], t);
    if (removedChatsCount) {
      const original = originalImport;
      const total = Array.isArray(original) ? original.length : original.chats.length;
      showToast(`${t('reduceMessagesSuccess', { count: removedChatsCount })}. ${t('notifications.chatsImported', {
        ns: 'import', imported: total - removedChatsCount, total,
      })}`, 'info', 15000);
    }
    return result;
  } catch (error: unknown) {
    return committed
      ? { success: false, message: `storage-error: ${(error as Error).message}`, status: 'storage-error' }
      : buildFailureResult((error as Error).message);
  }
};


export type ImportPreviewSource = {
  chats: ChatInterface[];
  folders: FolderCollection;
  contentStore: ContentStoreData;
  evaluationResults: EvaluationResultMap;
  recoveredContentCount?: number;
  unavailableContent?: Record<string, string[]>;
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

const validatePreviewSource = (source: ImportPreviewSource) => {
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
export const prepareImportPreview = async (file: File, t: Translator): Promise<ImportPreviewSource> => {
  const raw = JSON.parse(await readImportFile(file));
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
  const base = useStore.getInitialState();
  const { result, plan } = await importParsedData(base, parsed, type, t, false, 'replace', false);
  if (!result.success) throw new Error(result.message);
  const source = previewSourceFromPlan(plan);
  source.recoveredContentCount = recoveredContentCount;
  source.unavailableContent = {};
  for (const chat of source.chats as PreviewChat[]) {
    if (chat.__previewMissingContent?.length) source.unavailableContent[chat.id] = chat.__previewMissingContent;
    delete chat.__previewMissingContent;
  }
  validatePreviewSource(source);
  return source;
};

/** Retry persistence after a committed import without appending the same chats again. */
export const retryImportPreviewSave = async (t: Translator): Promise<ImportResult> => {
  try {
    await saveChatData(createPersistedChatDataState({
      ...useStore.getState(), contentStore: deepClone(useStore.getState().contentStore),
    }));
    return buildSuccessResult(t('notifications.successfulImport', { ns: 'import' }));
  } catch (error) {
    return { success: false, message: `storage-error: ${(error as Error).message}`, status: 'storage-error' };
  }
};

export type ImportPreviewSelectionOptions = {
  fileName: string;
  selectedFolderIds: readonly string[];
};

const previewSourceFromPlan = (plan: StoreState): ImportPreviewSource => {
  // V3 also permits legacy flat chats; normalize before mounting reused views.
  for (const chat of plan.chats ?? []) {
    if (!chat.branchTree) chat.branchTree = flatMessagesToBranchTree(chat.messages, plan.contentStore);
  }
  const source: ImportPreviewSource = { chats: plan.chats ?? [], folders: plan.folders,
    contentStore: plan.contentStore, evaluationResults: plan.evaluationResults ?? {} };
  return source;
};

const chatNodeMaps = (chats: ChatInterface[]) => {
  const maps = (field: 'collapsedNodes' | 'omittedNodes' | 'protectedNodes') => Object.fromEntries(
    chats.flatMap((chat, index) => chat[field] && Object.keys(chat[field]!).length
      ? [[String(index), { ...chat[field] }]] : []));
  return { collapsedNodeMaps: maps('collapsedNodes'), omittedNodeMaps: maps('omittedNodes'),
    protectedNodeMaps: maps('protectedNodes') };
};

/** Shared by full file append and preview selection; source ids never merge with live ids. */
const buildPreviewAppendPatch = (
  base: StoreState, source: ImportPreviewSource, ids: readonly string[], t: Translator,
  options: ImportPreviewSelectionOptions
) => {
  validatePreviewSource(source);
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
  const contentStore = deepClone(base.contentStore);
  const chatIdMap: Record<string, string> = {};
  const chats = selected.map(original => {
    const prepared = prepareChatForExport(original, source.contentStore);
    const chat = prepared.chat;
    assignFreshChatIds([chat]);
    chatIdMap[original.id] = chat.id;
    chat.folder = original.folder ? folderIdMap[original.folder] : rootId;
    for (const node of Object.values(chat.branchTree!.nodes)) {
      node.contentHash = addContent(contentStore, prepared.contentStore[node.contentHash].content);
    }
    return chat;
  });
  const evaluationResults = Object.fromEntries(Object.entries(source.evaluationResults)
    .filter(([key]) => selectedIds.has(key.slice(0, key.indexOf(':')))));
  const selectedChatId = base.chats?.[base.currentChatIndex]?.id;
  const mergedChats = [...chats, ...(base.chats ?? [])];
  return {
    ...remapAppendedChatReferences(base, mergedChats), ...chatNodeMaps(mergedChats),
    chats: mergedChats, folders, contentStore,
    evaluationResults: { ...base.evaluationResults, ...remapEvaluationResultKeys(evaluationResults, chatIdMap) },
    currentChatIndex: selectedChatId ? mergedChats.findIndex(chat => chat.id === selectedChatId)
      : mergedChats.length ? 0 : -1,
  };
};

export const importSelectedPreview = async (
  source: ImportPreviewSource, ids: readonly string[], t: Translator,
  options: ImportPreviewSelectionOptions = { fileName: '', selectedFolderIds: [] }
): Promise<ImportResult> => {
  let committed = false;
  try {
    const base = useStore.getState();
    const patch = buildPreviewAppendPatch(base, source, ids, t, options);
    // Preparation is synchronous: commit against the latest live state without an async gap.
    committed = true;
    useStore.setState(patch);
    setLocalStorageItem('currentChatIndex', String(patch.currentChatIndex));
    return retryImportPreviewSave(t);
  } catch (error) {
    return committed
      ? { success: false, message: `storage-error: ${(error as Error).message}`, status: 'storage-error' }
      : buildFailureResult((error as Error).message);
  }
};
