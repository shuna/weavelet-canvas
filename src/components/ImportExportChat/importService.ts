import { v4 as uuidv4 } from 'uuid';
import { showToast } from '@utils/showToast';

import useStore from '@store/store';
import { createPartializedState } from '@store/store';
import type { StoreState } from '@store/store';
import { createPersistedChatDataState } from '@store/persistence';
import { saveChatData } from '@store/storage/IndexedDbStorage';
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
} from '@utils/import';
import { flatMessagesToBranchTree } from '@utils/branchUtils';
import { assignFreshChatIds } from '@utils/chatIdentity';
import { ContentStoreData, addContent } from '@utils/contentStore';
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
    if (chat.folder && !folders[chat.folder]) {
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

const readImportFile = async (file: File): Promise<string> => {
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

  return chats.length > 0
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

  return parsedData.chats && parsedData.chats.length > 0
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

  return parsedData.chats && parsedData.chats.length > 0
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

const importParsedData = async (
  base: StoreState,
  parsedData: unknown,
  type: ImportType,
  t: Translator,
  shouldAllowPartialImport: boolean,
  mode: ImportMode,
  includeSettings: boolean = true
): Promise<{ result: ImportResult; plan: StoreState; removedChatsCount?: number }> => {
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
    const parsedData = JSON.parse(data);
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
    const { result, plan, removedChatsCount } = await importParsedData(base, parsedData, type, t, false, mode, includeSettings);
    if (!result.success) return result;
    if (useStore.getState() !== base || JSON.stringify(snapshot(useStore.getState())) !== observed) {
      return { success: false, message: 'concurrent-change', status: 'concurrent-change' };
    }
    const chats = plan.chats ?? [];
    const maps = (field: 'collapsedNodes' | 'omittedNodes' | 'protectedNodes') => Object.fromEntries(
      chats.flatMap((chat, index) => chat[field] && Object.keys(chat[field]!).length
        ? [[String(index), { ...chat[field] }]] : [])
    );
    // Appends keep existing chat objects and their editing history intact.
    if (mode === 'append' && base.chats) chats.splice(chats.length - base.chats.length, base.chats.length, ...base.chats);
    const patch = {
      ...createPartializedState(plan),
      chats,
      contentStore: plan.contentStore,
      branchClipboard: plan.branchClipboard,
      currentChatIndex: mode === 'replace' ? (chats.length ? 0 : -1) : base.currentChatIndex,
      collapsedNodeMaps: maps('collapsedNodes'),
      omittedNodeMaps: maps('omittedNodes'),
      protectedNodeMaps: maps('protectedNodes'),
      ...(mode === 'replace' ? { branchHistoryPast: [], branchHistoryFuture: [] } : {}),
    };
    committed = true;
    useStore.setState(patch);
    if (mode === 'replace') setLocalStorageItem('currentChatIndex', String(chats.length ? 0 : -1));
    await saveChatData(createPersistedChatDataState({
      ...useStore.getState(), contentStore: deepClone(useStore.getState().contentStore),
    }));
    if (type === 'LegacyImport' || type === 'SingleChat') warnUnsupportedModels(type === 'LegacyImport' ? parsedData : [parsedData], t);
    if (removedChatsCount) {
      const original = JSON.parse(data);
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
