import { normalizeLegacyIOSImport } from '@utils/legacyIOSImport';
import { v4 as uuidv4 } from 'uuid';
import { showToast } from '@utils/showToast';

import useStore from '@store/store';
import { createPartializedState } from '@store/store';
import type { StoreState } from '@store/store';
import { createPersistedChatDataState, mergePersistedStoreState } from '@store/persistence';
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
import { flatChatToBranchTree, captureProjectedMessageAttributes, materializeActivePath } from '@utils/branchUtils';
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

export type {ImportResult,ImportMode,ImportPreviewSource,ImportPreviewSelectionOptions} from '@utils/fileImport';
import {assertImportDeltaIntegrity,importParsedData as convertImportData,prepareImportData,buildPreviewAppendPatch as prepareAppendPatch,decodeLegacyRemoteImport,detectImportType,buildFailureResult,buildSuccessResult,previewSourceFromPlan,isRecord,type ImportResult,type ImportMode,type ImportPreviewSource,type ImportPreviewSelectionOptions,type ImportDecisions,type Translator} from '@utils/fileImport';
const cloneState = <T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const deepClone = <T,>(value:T):T=>typeof structuredClone==='function'?structuredClone(value):cloneState(value);
const snapshot = (state:StoreState)=>deepClone(createPartializedState({...state,contentStore:deepClone(state.contentStore)}));
const importDataBase=(state:StoreState)=>({...snapshot(state),chats:state.chats,folders:state.folders}) as StoreState;
const importExtensions=(data:unknown)=>isRecord(data)&&typeof data.version==='number'?Object.fromEntries(Object.entries(data).filter(([key])=>!['version','chats','folders','contentStore','evaluationSettings','evaluationResults'].includes(key))):{};
const assertWebImportRoots=(extensions:Record<string,unknown>|undefined)=>{
 const defaults=createPartializedState(useStore.getInitialState());
 const collisions=Object.keys(extensions??{}).filter(key=>Object.hasOwn(defaults,key));
 if(collisions.length)throw new Error(`Import metadata conflicts with persisted settings: ${collisions.join(', ')}`);
};

const extractModelId=(chat:unknown)=>isRecord(chat)&&isRecord(chat.config)&&typeof chat.config.model==='string'?chat.config.model:undefined;

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
  if (file.name.toLowerCase().endsWith('.wvlt')) {
    const { readLegacySnapshotImport } = await import('../../utils/legacySnapshotImport');
    return readLegacySnapshotImport(file);
  }
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

const confirmImportDecision=(t:Translator)=>(decision:import('@utils/fileImport').ImportDecision)=>window.confirm(decision.kind==='partial-import'?t('partialImportWarning',{message:decision.message}):t('reduceMessagesFailedImportWarning'));
const importParsedData = async (base:StoreState,parsedData:unknown,type:ReturnType<typeof detectImportType>,t:Translator,allowPartial:boolean,mode:ImportMode,includeSettings=true) => {
 const converted=convertImportData(importDataBase(base),parsedData,type,t,allowPartial,mode,includeSettings,snapshot(useStore.getInitialState()) as StoreState,{},confirmImportDecision(t));
 return {...converted,plan:mergePersistedStoreState(base,converted.plan)};
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
    const parsedData: typeof raw = legacyRemote ? decodeLegacyRemoteImport(legacyRemote) : normalizeLegacyIOSImport(raw);
    const originalImport = deepClone(parsedData);
    const extensions=importExtensions(parsedData);
    assertWebImportRoots(extensions);
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
    // Reject corrupt input before cancellation can finalize or stop live AI tasks.
    if (mode === 'replace' && type === 'ExportV3') assertImportDeltaIntegrity(parsedData.contentStore);
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
    const rootBase=mergePersistedStoreState(base,extensions);
    const patch = mode === 'append'
      ? buildPreviewAppendPatch(rootBase, previewSourceFromPlan(plan), chats.map(chat => chat.id), t, {
          fileName: file.name, selectedFolderIds: Object.keys(plan.folders),
        }, true)
      : {
          ...mergePersistedStoreState(mergePersistedStoreState(base, createPartializedState(plan)), extensions), chats, contentStore: plan.contentStore,
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


/** Converts a detached file through the same core used by native. */
export const prepareImportPreview = async (file:File,t:Translator):Promise<ImportPreviewSource> => {
 const prepared=prepareImportData(JSON.parse(await readImportFile(file)),snapshot(useStore.getInitialState()) as StoreState,t,{},confirmImportDecision(t));
 if(prepared.status==='ready')return prepared.source;
 throw new Error(prepared.result.message);
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

const chatNodeMaps = (chats: ChatInterface[]) => {
  const maps = (field: 'collapsedNodes' | 'omittedNodes' | 'protectedNodes') => Object.fromEntries(
    chats.flatMap((chat, index) => chat[field] && Object.keys(chat[field]!).length
      ? [[String(index), { ...chat[field] }]] : []));
  return { collapsedNodeMaps: maps('collapsedNodes'), omittedNodeMaps: maps('omittedNodes'),
    protectedNodeMaps: maps('protectedNodes') };
};

const buildPreviewAppendPatch=(base:StoreState,source:ImportPreviewSource,ids:readonly string[],t:Translator,options:ImportPreviewSelectionOptions,completeFileImport=false)=>{
 assertWebImportRoots(source.extensions);
 const rooted=mergePersistedStoreState(base,source.extensions??{});
 const data=prepareAppendPatch(importDataBase(rooted),source,ids,t,options,completeFileImport,base.chats?.[base.currentChatIndex]?.id);
 return {...rooted,...data,...remapAppendedChatReferences(base,data.chats),...chatNodeMaps(data.chats)};
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
