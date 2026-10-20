import { InfoTooltip } from '@components/ConfigMenu/fields';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import Toggle from '@components/Toggle';
import { SettingsGroup } from './SettingsMenu';
import {
  localModelRuntime,
  promptAsInput,
  type WllamaEnvironmentReport,
  type WllamaFeatureCheck,
} from '@src/local-llm/runtime';
import type { VariantOverride as WasmVariantOverride } from '@src/vendor/wllama/variant-table';
import { OpfsFileProvider, equalBlobBytes, getTempFileSize, readFile, saveFile, sha256Blob } from '@src/local-llm/storage';
import { removeAssets } from '@src/local-llm/assetRemoval';
import { rehydrateLocalModels } from '@hooks/useLocalModelRehydration';
import { CURATED_MODELS } from '@src/local-llm/catalog';
import type { CatalogModel } from '@src/local-llm/catalog';
import { catalogDefinition } from '@src/local-llm/catalogPlan';
import { downloadCatalogModel, downloadModelFiles } from '@src/local-llm/download';
import { estimateDeviceTier, getModelFit } from '@src/local-llm/device';
import type { DeviceTier } from '@src/local-llm/device';
import { localAnalyze, localFormat } from '@api/localGeneration';
import type {
  LocalModelDefinition,
  LocalModelStatus,
  LocalModelTask,
  HfSearchResult,
  GgufVariant,
} from '@src/local-llm/types';
import {
  downloadPlan as buildSearchDownloadPlan,
  resolveGgufFiles,
  generateSearchModelId,
} from '@src/local-llm/hfSearch';
import { getManifestFiles, getManifestPrimaryFile } from '@src/local-llm/ggufShardUtils';
import OpfsFileBrowser from './OpfsFileBrowser';

import { ASSIGNABLE_TASKS, getModelStatusLabel } from './localModelConstants';
import { StatusBadge, FitBadge, SortableColumnHeader, FilterInfoButton } from './LocalModelBadges';
import { CatalogCard, DownloadedModelRow, DownloadingModelRow, TaskAssignmentRow } from './LocalModelCards';
import SearchResultCard from './SearchResultCard';
import { useModelDownload } from '@src/hooks/useModelDownload';
import { useModelDeletion } from '@src/hooks/useModelDeletion';
import { autoAssignImportedModel, commitCatalogDuplicate, commitSelectedGGUFImport, findSelectedGGUFDuplicate, inspectSelectedGGUFs, prepareSelectedGGUFImport } from '@utils/localModelImport';
import { useHfSearch } from '@src/hooks/useHfSearch';

const MDN_FEATURE_LINKS = {
  secureContext: 'https://developer.mozilla.org/en-US/docs/Glossary/Secure_Context',
  memory64: 'https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface',
  jspi: 'https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface',
  sharedArrayBuffer: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer',
  crossOriginIsolated: 'https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated',
  multiThread: 'https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated',
  webgpuApi: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API',
  requestAdapter: 'https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter',
  shaderF16: 'https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures',
  requestDevice: 'https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapter/requestDevice',
  webgpuPreflight: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API',
} as const;

function formatEstimatedGiB(value: number | null): string {
  if (!value || value <= 0) return '—';
  return `${value} GB`;
}

// Helper: build a fake HfSearchResult from a persisted model definition
function buildFakeSearchResult(model: LocalModelDefinition, variant: { size: number }): HfSearchResult {
  return {
    repoId: model.origin!,
    repoUrl: `https://huggingface.co/${model.origin}`,
    description: '',
    tags: [],
    downloads: 0,
    lastModified: '',
    bestCandidateSize: variant.size,
    supportStatus: 'supported',
    supportReason: '',
    engine: model.engine,
  };
}

const LocalModelSettings = () => {
  const { t } = useTranslation('main');

  // Store state
  const localModelEnabled = useStore((s) => s.localModelEnabled);
  const setLocalModelEnabled = useStore((s) => s.setLocalModelEnabled);
  const savedModelMeta = useStore((s) => s.savedModelMeta);
  const localModels = useStore((s) => s.localModels);
  const activeLocalModels = useStore((s) => s.activeLocalModels);
  const favoriteLocalModelIds = useStore((s) => s.favoriteLocalModelIds);
  const toggleFavoriteLocalModel = useStore((s) => s.toggleFavoriteLocalModel);

  // Local UI state
  const [enabled, setEnabled] = useState(localModelEnabled);
  const [rehydrated, setRehydrated] = useState(false);
  const [webGpuEnabled, setWebGpuEnabled] = useState<boolean | null>(() => localModelRuntime.getWebGpuEnabled());
  const [webGpuCapable, setWebGpuCapable] = useState<boolean | null>(null);
  const [webGpuPreflighting, setWebGpuPreflighting] = useState(false);
  const [envReport, setEnvReport] = useState<WllamaEnvironmentReport | null>(null);
  const [showFeatureChecklist, setShowFeatureChecklist] = useState(false);
  const [wasmVariantOverride, setWasmVariantOverrideState] = useState<WasmVariantOverride>(() => localModelRuntime.getWasmVariantOverride());

  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ephemeralLoadError, setEphemeralLoadError] = useState<string | null>(null);
  const [importedModelId, setImportedModelId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [contextLength, setContextLength] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<'generate' | 'analyze' | 'format'>('generate');
  const [analyzeInstruction, setAnalyzeInstruction] = useState('');
  const [formatPreset, setFormatPreset] = useState<'summarize' | 'rewrite' | 'bullets'>('summarize');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // OPFS browser refresh trigger: increment on every storage mutation.
  const [opfsBrowserRefresh, setOpfsBrowserRefresh] = useState(0);
  const bumpOpfsBrowser = useCallback(() => setOpfsBrowserRefresh((n) => n + 1), []);

  // Hooks
  const { downloadProgresses, resumeFallbacks, abortControllers, startDownload, cancelDownload, clearProgress, clearResumeFallback } = useModelDownload(bumpOpfsBrowser);
  const { deleteWithConfirm } = useModelDeletion();
  const hfSearch = useHfSearch(rehydrated);

  // Runtime statuses for all known models
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<string, LocalModelStatus>>(() => {
    const initial: Record<string, LocalModelStatus> = {};
    for (const model of CURATED_MODELS) {
      initial[model.id] = localModelRuntime.getStatus(model.id);
    }
    for (const m of useStore.getState().localModels) {
      if (!(m.id in initial)) {
        initial[m.id] = localModelRuntime.getStatus(m.id);
      }
    }
    return initial;
  });

  const deviceTier = useMemo(() => estimateDeviceTier(), []);
  const resolvedWebGpuEnabled = webGpuEnabled ?? webGpuCapable === true;
  const webGpuStatusText = webGpuPreflighting
    ? t('localModel.webgpuPreflightChecking')
    : webGpuEnabled === false
      ? t('localModel.webgpuDisabled')
      : webGpuCapable === null
        ? t('localModel.webgpuChecking')
        : webGpuCapable
          ? t('localModel.webgpuAvailable')
          : t('localModel.webgpuUnavailable');

  const featureRows = useMemo(() => {
    if (!envReport) return [];

    const { requestAdapter, requestDevice, webgpuPreflight } = envReport.checks;
    const verdictState: WllamaFeatureCheck['state'] =
      webgpuPreflight.state === 'ok'
        ? 'ok'
        : (requestAdapter.state === 'no' || requestDevice.state === 'no' || webgpuPreflight.state === 'no')
          ? 'no'
          : 'unknown';
    const verdictSummary =
      verdictState === 'ok'
        ? t('localModel.featureWebGpuVerdictOk')
        : verdictState === 'no'
          ? t('localModel.featureWebGpuVerdictNo')
          : t('localModel.featureWebGpuVerdictUnknown');
    const stateLabel = (s: WllamaFeatureCheck['state']) =>
      s === 'ok' ? t('localModel.featureStatusOk')
        : s === 'no' ? t('localModel.featureStatusNo')
          : t('localModel.featureStatusUnknown');
    const verdictDetail = [
      verdictSummary,
      `・${t('localModel.featureWebGpuVerdictRequestAdapter')} [${stateLabel(requestAdapter.state)}]: ${requestAdapter.detail}`,
      `・${t('localModel.featureWebGpuVerdictRequestDevice')} [${stateLabel(requestDevice.state)}]: ${requestDevice.detail}`,
      `・${t('localModel.featureWebGpuVerdictPreflight')} [${stateLabel(webgpuPreflight.state)}]: ${webgpuPreflight.detail}`,
    ].join('\n');

    const rows: Array<{
      key: keyof WllamaEnvironmentReport['checks'];
      category: string;
      label: string;
      docUrl: string | null;
      check: WllamaFeatureCheck;
    }> = [
      { key: 'secureContext', category: t('localModel.featureCategoryPlatform'), label: t('localModel.featureSecureContext'), docUrl: MDN_FEATURE_LINKS.secureContext, check: envReport.checks.secureContext },
      { key: 'memory64', category: t('localModel.featureCategoryCpuMemory'), label: t('localModel.featureMemory64'), docUrl: MDN_FEATURE_LINKS.memory64, check: envReport.checks.memory64 },
      { key: 'sharedArrayBuffer', category: t('localModel.featureCategoryThreading'), label: t('localModel.featureSharedArrayBuffer'), docUrl: MDN_FEATURE_LINKS.sharedArrayBuffer, check: envReport.checks.sharedArrayBuffer },
      { key: 'crossOriginIsolated', category: t('localModel.featureCategoryThreading'), label: t('localModel.featureCrossOriginIsolated'), docUrl: MDN_FEATURE_LINKS.crossOriginIsolated, check: envReport.checks.crossOriginIsolated },
      { key: 'multiThread', category: t('localModel.featureCategoryThreading'), label: t('localModel.featureMultiThread'), docUrl: MDN_FEATURE_LINKS.multiThread, check: envReport.checks.multiThread },
      { key: 'webgpuApi', category: t('localModel.featureCategoryWebGpu'), label: t('localModel.featureWebGpuApi'), docUrl: MDN_FEATURE_LINKS.webgpuApi, check: envReport.checks.webgpuApi },
      { key: 'jspi', category: t('localModel.featureCategoryWebGpu'), label: t('localModel.featureJspi'), docUrl: MDN_FEATURE_LINKS.jspi, check: envReport.checks.jspi },
      { key: 'exnref', category: t('localModel.featureCategoryWebGpu'), label: t('localModel.featureExnref'), docUrl: null, check: envReport.checks.exnref },
      { key: 'shaderF16', category: t('localModel.featureCategoryWebGpu'), label: t('localModel.featureShaderF16'), docUrl: MDN_FEATURE_LINKS.shaderF16, check: envReport.checks.shaderF16 },
      {
        key: 'webgpuPreflight',
        category: t('localModel.featureCategoryWebGpu'),
        label: t('localModel.featureWebGpuVerdict'),
        docUrl: null,
        check: { state: verdictState, detail: verdictDetail },
      },
    ];
    return rows;
  }, [envReport, t]);

  // Derive active test model from task assignments
  const generationModelId = activeLocalModels.generation ?? null;
  const analysisModelId = activeLocalModels.analysis ?? null;

  const getTestModelId = useCallback((mode: 'generate' | 'analyze' | 'format'): string | null => {
    if (mode === 'generate') return generationModelId;
    return analysisModelId ?? generationModelId;
  }, [generationModelId, analysisModelId]);

  const hasAnyAssignment = generationModelId !== null || analysisModelId !== null;

  const isTestModelLoaded = useCallback((mode: 'generate' | 'analyze' | 'format'): boolean => {
    const modelId = getTestModelId(mode);
    if (!modelId) return false;
    const status = runtimeStatuses[modelId] ?? 'idle';
    return status === 'ready' || status === 'busy';
  }, [getTestModelId, runtimeStatuses]);

  // Sync toggle to store
  useEffect(() => { setLocalModelEnabled(enabled); }, [enabled]);

  const runEnvironmentInspection = useCallback(async (): Promise<WllamaEnvironmentReport | null> => {
    setWebGpuPreflighting(true);
    try {
      const report = await localModelRuntime.inspectWllamaEnvironment();
      setEnvReport(report);
      setWebGpuCapable(report.checks.webgpuPreflight.state === 'ok');
      return report;
    } catch {
      setWebGpuCapable(false);
      return null;
    } finally {
      setWebGpuPreflighting(false);
    }
  }, []);

  const setEnabledWithPreflight = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((action) => {
    setEnabled((prev) => {
      const next = typeof action === 'function'
        ? (action as (value: boolean) => boolean)(prev)
        : action;
      if (!prev && next && webGpuEnabled !== false) {
        void runEnvironmentInspection();
      }
      return next;
    });
  }, [runEnvironmentInspection, webGpuEnabled]);

  const handleWebGpuToggle = useCallback(() => {
    const next = !resolvedWebGpuEnabled;
    setWebGpuEnabled(next);
    localModelRuntime.setWebGpuEnabled(next);
    if (next) void runEnvironmentInspection();
  }, [resolvedWebGpuEnabled, runEnvironmentInspection]);

  useEffect(() => {
    if (!enabled) return;
    void runEnvironmentInspection();
  }, [enabled, runEnvironmentInspection]);

  // Subscribe to runtime status changes
  useEffect(() => {
    const unsubscribe = localModelRuntime.subscribe(() => {
      const newStatuses: Record<string, LocalModelStatus> = {};
      for (const model of CURATED_MODELS) {
        newStatuses[model.id] = localModelRuntime.getStatus(model.id);
      }
      for (const m of useStore.getState().localModels) {
        if (!(m.id in newStatuses)) {
          newStatuses[m.id] = localModelRuntime.getStatus(m.id);
        }
      }
      setRuntimeStatuses(newStatuses);
    });
    return unsubscribe;
  }, []);

  // Rehydrate OPFS state on first mount and after storage mutations.
  const [rehydrationEpoch, setRehydrationEpoch] = useState(0);
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    if (rehydratedRef.current && rehydrationEpoch === 0) return;
    rehydratedRef.current = true;

    rehydrateLocalModels(rehydrationEpoch > 0)
      .then(() => setRehydrated(true))
      .catch(() => setRehydrated(true));
  }, [enabled, rehydrationEpoch]);

  // Sync partial model storedBytes on section mount
  useEffect(() => {
    if (!rehydrated) return;
    const metas = useStore.getState().savedModelMeta;
    for (const [id, meta] of Object.entries(metas)) {
      if (meta.storageState === 'partial') {
        const model = CURATED_MODELS.find((c) => c.id === id)
          ?? useStore.getState().localModels.find((m) => m.id === id);
        if (!model) continue;
        const file = getManifestPrimaryFile(model.manifest);
        if (!file) continue;
        getTempFileSize(id, file).then((size) => {
          if (size > 0) {
            useStore.getState().updateSavedModelMeta(id, { storedBytes: size });
          }
        });
      }
    }
  }, [rehydrated]);

  // ----- Auto-assignment helper -----
  const autoAssignIfUnset = useCallback((modelId: string, tasks: LocalModelTask[]) => {
    const store = useStore.getState();
    const next = autoAssignImportedModel(store.activeLocalModels, {id: modelId, tasks});
    for (const task of tasks) if (next[task] !== store.activeLocalModels[task]) store.setActiveLocalModel(task, modelId);
  }, []);

  const findStoredSelectedGGUF = useCallback(async (
    selection: ReturnType<typeof inspectSelectedGGUFs>,
    files: Array<{name: string; size: number; hash: string}>,
    incomingFiles: Blob[],
    excludeModelId?: string,
  ): Promise<LocalModelDefinition | null> => {
    const store = useStore.getState();
    const candidates = [
      ...CURATED_MODELS.map((model) => ({
        id: model.id, engine: model.engine, tasks: model.tasks, label: model.label,
        origin: model.huggingFaceRepo, source: 'opfs' as const, manifest: model.manifest,
        fileSize: model.expectedDownloadSize, displayMeta: model.displayMeta,
      })),
      ...store.localModels,
    ];
    const inspected: Array<{model: LocalModelDefinition; kind: 'single-file' | 'gguf-sharded'; hashes: string[]; size?: number}> = [];
    for (const model of candidates) {
      if (model.id === excludeModelId) continue;
      const kind = model.manifest.kind;
      if (model.engine !== 'wllama' || (kind !== 'single-file' && kind !== 'gguf-sharded')) continue;
      const metadata = store.savedModelMeta[model.id];
      if (metadata?.storageState !== 'saved') continue;
      const hashes = {...metadata.fileHashes};
      try {
        for (const path of getManifestFiles(model.manifest)) {
          if (!hashes[path]) hashes[path] = await sha256Blob(await readFile(model.id,path));
        }
      } catch {
        continue;
      }
      store.updateSavedModelMeta(model.id,{fileHashes:hashes});
      inspected.push({model,kind,hashes:getManifestFiles(model.manifest).map((path) => hashes[path]),size:metadata.storedBytes || undefined});
    }
    for (const candidate of inspected) {
      const id = findSelectedGGUFDuplicate(selection,files,[{
        id:candidate.model.id, engine:candidate.model.engine, kind:candidate.kind, hashes:candidate.hashes, size:candidate.size,
      }]);
      if (id === null) continue;
      const paths = getManifestFiles(candidate.model.manifest);
      var matches = true;
      for (const [index,path] of paths.entries()) {
        if (!await equalBlobBytes(incomingFiles[index],await readFile(candidate.model.id,path))) {
          matches = false;
          break;
        }
      }
      if (matches) return candidate.model;
    }
    return null;
  }, []);

  const registerDownloadedOrUseDuplicate = useCallback(async (model: LocalModelDefinition, _totalBytes: number) => {
    if (model.engine !== 'wllama'
      || (model.manifest.kind !== 'single-file' && model.manifest.kind !== 'gguf-sharded')) {
      useStore.getState().addLocalModel(model);
      return;
    }

    const store = useStore.getState();
    try {
      const files: Blob[] = [];
      const inspectedFiles: Array<{name: string; size: number; hash: string}> = [];
      for (const path of getManifestFiles(model.manifest)) {
        const file = await readFile(model.id,path);
        files.push(file);
        inspectedFiles.push({name:path,size:file.size,hash:await sha256Blob(file)});
      }
      const selection = inspectSelectedGGUFs(inspectedFiles.map(({name,size}) => ({name,size})));
      store.updateSavedModelMeta(model.id, {
        fileHashes: Object.fromEntries(inspectedFiles.map((file) => [file.name,file.hash])),
      });
      const duplicate = await findStoredSelectedGGUF(selection,inspectedFiles,files,model.id);
      if (duplicate) {
        const removal = await removeAssets(model.id);
        if (removal.status !== 'removed') return;
        const current = useStore.getState();
        useStore.setState(commitCatalogDuplicate({
          localModels: current.localModels,
          activeLocalModels: current.activeLocalModels,
          favoriteLocalModelIds: current.favoriteLocalModelIds,
          savedModelMeta: current.savedModelMeta,
        }, model.id, duplicate));
        bumpOpfsBrowser();
        return;
      }
    } catch {
      // Keep the just-downloaded model if hashing or duplicate lookup fails.
    }

    store.addLocalModel(model);
  }, [bumpOpfsBrowser, findStoredSelectedGGUF]);

  // ----- Catalog download handlers (thin wrappers using useModelDownload) -----
  const handleDownload = useCallback((model: CatalogModel) => {
    const store = useStore.getState();
    store.updateSavedModelMeta(model.id, { storedBytes: 0, storedFiles: [], downloadRevision: model.revision });
    startDownload(model.id, (cb, sig) => downloadCatalogModel(model, cb, sig), {
      storedFiles: [...model.downloadFiles],
      onComplete: (totalBytes) => {
        void registerDownloadedOrUseDuplicate(catalogDefinition(model, totalBytes), totalBytes);
      },
    });
  }, [registerDownloadedOrUseDuplicate, startDownload]);

  const handleResumeCatalog = useCallback((model: CatalogModel) => {
    clearResumeFallback(model.id);
    startDownload(model.id, (cb, sig) => downloadCatalogModel(model, cb, sig, true), {
      resume: true,
      storedFiles: [...model.downloadFiles],
      resumeFallbackMsg: t('localModel.resumeFallback') as string,
    });
  }, [startDownload, clearResumeFallback, t]);

  const handleCancelDownload = useCallback((modelId: string) => {
    cancelDownload(modelId);
  }, [cancelDownload]);

  const handleRetry = useCallback((model: CatalogModel) => {
    handleDownload(model);
  }, [handleDownload]);

  // ----- Catalog deletion / load / unload -----
  const handleDeleteCatalogModel = useCallback(async (modelId: string) => {
    await deleteWithConfirm(modelId, { abortControllers, clearProgress, onDeleted: bumpOpfsBrowser });
  }, [deleteWithConfirm, clearProgress, bumpOpfsBrowser]);

  const handleLoadCatalogModel = useCallback(async (model: CatalogModel) => {
    const provider = new OpfsFileProvider(model.id, model.manifest);
    try {
      if (localModelRuntime.isLoaded(model.id)) {
        await localModelRuntime.unloadModel(model.id, { force: true });
      }
      await localModelRuntime.loadModel(
        { id: model.id, engine: model.engine, tasks: model.tasks, label: model.label,
          origin: model.huggingFaceRepo, source: 'opfs', manifest: model.manifest },
        provider,
      );
      const store = useStore.getState();
      store.addLocalModel({
        id: model.id, engine: model.engine, tasks: model.tasks, label: model.label,
        origin: model.huggingFaceRepo, source: 'opfs', manifest: model.manifest,
      });
      autoAssignIfUnset(model.id, model.tasks);
      if (!store.favoriteLocalModelIds.includes(model.id)) {
        store.toggleFavoriteLocalModel(model.id);
      }
      const caps = localModelRuntime.getCapabilities(model.id);
      if (caps?.contextLength) setContextLength(caps.contextLength);
      setOutput('');
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [autoAssignIfUnset]);

  const handleUnloadCatalogModel = useCallback(async (modelId: string) => {
    await localModelRuntime.unloadModel(modelId, { force: true });
  }, []);

  // ----- Ephemeral file handlers -----
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setEphemeralLoadError(null);
    setOutput('');
    setContextLength(null);
    try {
      const selectedFiles = Array.from(fileList);
      const selection = inspectSelectedGGUFs(selectedFiles.map(({name,size}) => ({name,size})));
      const filesByName = new Map(selectedFiles.map((file) => [file.name,file]));
      const orderedFiles = selection.files.map((file) => filesByName.get(file.name)!);
      const inspectedFiles: Array<{name: string; size: number; hash: string}> = [];
      for (const file of orderedFiles) inspectedFiles.push({name:file.name,size:file.size,hash:await sha256Blob(file)});
      const existingModel = await findStoredSelectedGGUF(selection,inspectedFiles,orderedFiles);
      const store = useStore.getState();
      const model = prepareSelectedGGUFImport(selection,inspectedFiles[0].hash,existingModel ?? undefined,store.localModels.map(({id}) => id)).model;
      setFileName(selection.displayLabel);

      if (!existingModel) {
        const storedFiles: string[] = [];
        const fileHashes: Record<string, string> = {};
        for (const [index, file] of orderedFiles.entries()) {
          await saveFile(model.id, file.name, file);
          storedFiles.push(file.name);
          fileHashes[file.name] = inspectedFiles[index].hash;
        }
        store.updateSavedModelMeta(model.id, {
          storageState: 'saved',
          storedBytes: selection.totalSize,
          storedFiles,
          fileHashes,
          lastVerifiedAt: Date.now(),
          lastError: undefined,
        });
        store.addLocalModel(model);
      }

      if (localModelRuntime.isLoaded(model.id)) await localModelRuntime.unloadModel(model.id, { force: true });

      await localModelRuntime.loadModel(
        model,
        new OpfsFileProvider(model.id, model.manifest),
      );
      const caps = localModelRuntime.getCapabilities(model.id);
      if (caps?.contextLength) setContextLength(caps.contextLength);
      setImportedModelId(model.id);
      const current = useStore.getState();
      useStore.setState(commitSelectedGGUFImport({
        localModels: current.localModels,
        activeLocalModels: current.activeLocalModels,
        favoriteLocalModelIds: current.favoriteLocalModelIds,
      },model,current.localModels.map(({id}) => id)));
      setSelectedModelId(null);
      bumpOpfsBrowser();
    } catch (err) {
      setEphemeralLoadError((err as Error).message);
    }
    e.target.value = '';
  }, [bumpOpfsBrowser, findStoredSelectedGGUF]);

  const handleUnloadEphemeral = useCallback(async () => {
    if (importedModelId) await localModelRuntime.unloadModel(importedModelId, { force: true });
    setContextLength(null);
    setFileName(null);
    setImportedModelId(null);
    setOutput('');
  }, [importedModelId]);

  // ----- Task assignment -----
  const handleTaskAssign = useCallback((task: LocalModelTask, modelId: string | null) => {
    useStore.getState().setActiveLocalModel(task, modelId);
  }, []);

  const getTaskCandidates = useCallback((task: LocalModelTask) => {
    const seen = new Set<string>();
    const candidates: Array<{ id: string; label: string; statusLabel: string }> = [];
    for (const m of localModels) {
      if (!m.tasks.includes(task)) continue;
      seen.add(m.id);
      const status = runtimeStatuses[m.id] ?? 'idle';
      const statusLabel = getModelStatusLabel(m.id, m.source, status);
      candidates.push({ id: m.id, label: m.label, statusLabel: t(`localModel.${statusLabel}`) });
    }
    for (const cm of CURATED_MODELS) {
      if (seen.has(cm.id)) continue;
      if (!cm.tasks.includes(task)) continue;
      const meta = savedModelMeta[cm.id];
      if (!meta || meta.storageState !== 'saved') continue;
      candidates.push({ id: cm.id, label: cm.label, statusLabel: t('localModel.saved') });
    }
    return candidates;
  }, [localModels, runtimeStatuses, savedModelMeta, t]);

  // ----- Generation / Testing -----
  const handleGenerate = useCallback(async () => {
    const modelId = getTestModelId('generate');
    if (!prompt.trim() || !modelId) return;
    const engine = localModelRuntime.getWllamaEngine(modelId);
    if (!engine) return;
    setGenerating(true);
    setOutput('');
    try {
      await engine.generate(promptAsInput(prompt), { maxTokens: 256, temperature: 0.7 }, (text) => {
        setOutput(text);
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }, 'test');
    } catch (err) {
      setOutput((prev) => prev + `\n[Error: ${(err as Error).message}]`);
    } finally {
      setGenerating(false);
    }
  }, [prompt, getTestModelId]);

  const handleAnalyze = useCallback(async () => {
    if (!prompt.trim() || !analyzeInstruction.trim()) return;
    setGenerating(true);
    setOutput('');
    try {
      const result = await localAnalyze(prompt, analyzeInstruction, 'test');
      setOutput(result);
    } catch (err) {
      setOutput(`[Error: ${(err as Error).message}]`);
    } finally {
      setGenerating(false);
    }
  }, [prompt, analyzeInstruction]);

  const handleFormat = useCallback(async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setOutput('');
    try {
      const result = await localFormat(prompt, formatPreset, 'test');
      setOutput(result);
    } catch (err) {
      setOutput(`[Error: ${(err as Error).message}]`);
    } finally {
      setGenerating(false);
    }
  }, [prompt, formatPreset]);

  const handleAbort = useCallback(() => {
    const modelId = getTestModelId(testMode);
    if (!modelId) return;
    localModelRuntime.getWllamaEngine(modelId)?.abort();
  }, [getTestModelId, testMode]);

  // ----- Search model download/resume/load/delete (thin wrappers) -----
  const handleDownloadSearchResult = useCallback((result: HfSearchResult, variant: GgufVariant) => {
    const existingId = hfSearch.findExistingModelForVariant(result.repoId, variant.fileName);
    if (existingId) {
      const meta = useStore.getState().savedModelMeta[existingId];
      if (meta?.storageState === 'saved' || meta?.storageState === 'downloading' || abortControllers.current[existingId]) return;
    }
    let plan;
    try { plan = buildSearchDownloadPlan(result, variant); } catch { return; }
    const modelId = plan.model.id;
    if (abortControllers.current[modelId]) return;

    hfSearch.setActiveSearchDownloads((prev) => ({ ...prev, [modelId]: { result, variant, modelId } }));

    const store = useStore.getState();
    if (!store.localModels.some((m) => m.id === modelId)) {
      store.addLocalModel(plan.definition);
    }

    startDownload(modelId, (cb, sig) => downloadModelFiles({
      modelId, repo: plan.model.huggingFaceRepo, revision: plan.model.revision, files: plan.model.downloadFiles,
    }, cb, sig), {
      storedFiles: [...plan.model.downloadFiles],
      onComplete: (totalBytes) => {
        hfSearch.setActiveSearchDownloads((prev) => { const { [modelId]: _, ...rest } = prev; return rest; });
        void registerDownloadedOrUseDuplicate(buildSearchDownloadPlan(result, variant, totalBytes).definition, totalBytes);
      },
    });
  }, [registerDownloadedOrUseDuplicate, startDownload, hfSearch.findExistingModelForVariant, hfSearch.setActiveSearchDownloads]);

  const handleResumeSearchModel = useCallback((result: HfSearchResult, variant: GgufVariant) => {
    let plan;
    try { plan = buildSearchDownloadPlan(result, variant); } catch { return; }
    const modelId = plan.model.id;
    if (abortControllers.current[modelId]) return;

    hfSearch.setActiveSearchDownloads((prev) => ({ ...prev, [modelId]: { result, variant, modelId } }));
    clearResumeFallback(modelId);

    startDownload(modelId, (cb, sig) => downloadModelFiles({
      modelId, repo: plan.model.huggingFaceRepo, revision: plan.model.revision, files: plan.model.downloadFiles, resume: true,
    }, cb, sig), {
      resume: true,
      storedFiles: [...plan.model.downloadFiles],
      resumeFallbackMsg: t('localModel.resumeFallback') as string,
      onComplete: () => {
        hfSearch.setActiveSearchDownloads((prev) => { const { [modelId]: _, ...rest } = prev; return rest; });
      },
    });
  }, [startDownload, clearResumeFallback, hfSearch.setActiveSearchDownloads, t]);

  const handleRetrySearchModel = useCallback((result: HfSearchResult, variant: GgufVariant) => {
    handleDownloadSearchResult(result, variant);
  }, [handleDownloadSearchResult]);

  const handleCancelSearchDownload = useCallback((modelId: string) => {
    cancelDownload(modelId);
  }, [cancelDownload]);

  const handleLoadSearchModel = useCallback(async (result: HfSearchResult, variant: GgufVariant) => {
    let plan;
    try { plan = buildSearchDownloadPlan(result, variant); } catch { return; }
    const modelId = plan.model.id;
    const provider = new OpfsFileProvider(modelId, plan.model.manifest);
    try {
      if (localModelRuntime.isLoaded(modelId)) await localModelRuntime.unloadModel(modelId, { force: true });
      await localModelRuntime.loadModel(
        plan.definition,
        provider,
      );
      const store = useStore.getState();
      if (!store.localModels.some((m) => m.id === modelId)) {
        store.addLocalModel(plan.definition);
      }
      autoAssignIfUnset(modelId, plan.model.tasks);
      if (!store.favoriteLocalModelIds.includes(modelId)) store.toggleFavoriteLocalModel(modelId);
      setOutput('');
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [autoAssignIfUnset]);

  const handleUnloadSearchModel = useCallback(async (modelId: string) => {
    await localModelRuntime.unloadModel(modelId, { force: true });
  }, []);

  const handleDeleteSearchModel = useCallback(async (modelId: string) => {
    await deleteWithConfirm(modelId, {
      abortControllers, clearProgress,
      onDeleted: () => {
        hfSearch.setActiveSearchDownloads((prev) => { const { [modelId]: _, ...rest } = prev; return rest; });
        bumpOpfsBrowser();
      },
    });
  }, [deleteWithConfirm, clearProgress, hfSearch.setActiveSearchDownloads, bumpOpfsBrowser]);

  // ----- Downloading section handlers -----
  const handleLoadSelected = useCallback(async () => {
    if (!selectedModelId) return;
    setLoadError(null);
    try {
      await localModelRuntime.ensureLoaded(selectedModelId);
      const store = useStore.getState();
      if (!store.localModels.some((m) => m.id === selectedModelId)) {
        const catalog = CURATED_MODELS.find((c) => c.id === selectedModelId);
        if (catalog) {
          store.addLocalModel({
            id: catalog.id, engine: catalog.engine, tasks: catalog.tasks, label: catalog.label,
            origin: catalog.huggingFaceRepo, source: 'opfs', manifest: catalog.manifest,
            fileSize: catalog.expectedDownloadSize, displayMeta: catalog.displayMeta,
          });
        }
      }
      const def = store.localModels.find((m) => m.id === selectedModelId);
      if (def) {
        autoAssignIfUnset(selectedModelId, def.tasks);
        if (!store.favoriteLocalModelIds.includes(selectedModelId)) store.toggleFavoriteLocalModel(selectedModelId);
      }
      setSelectedModelId(null);
      setOutput('');
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [selectedModelId, autoAssignIfUnset]);

  const handleResumeDownloadingModel = useCallback(async (modelId: string) => {
    const model = localModels.find((m) => m.id === modelId);
    const catalogModel = CURATED_MODELS.find((c) => c.id === modelId);
    if (catalogModel) { handleResumeCatalog(catalogModel); return; }
    if (!model?.origin) return;
    const fileName = model.manifest ? getManifestPrimaryFile(model.manifest) : undefined;
    if (!fileName) return;
    try {
      const resolution = await resolveGgufFiles(model.origin);
      if (!resolution) return;
      const variant = resolution.variants.find((v) => v.fileName === fileName);
      if (!variant) return;
      handleResumeSearchModel(buildFakeSearchResult(model, variant), variant);
    } catch {
      handleRetryDownloadingModel(modelId);
    }
  }, [localModels, handleResumeSearchModel]);

  const handleRetryDownloadingModel = useCallback(async (modelId: string) => {
    const model = localModels.find((m) => m.id === modelId);
    const catalogModel = CURATED_MODELS.find((c) => c.id === modelId);
    if (catalogModel) { handleDownload(catalogModel); return; }
    if (!model?.origin) return;
    const fileName = model.manifest ? getManifestPrimaryFile(model.manifest) : undefined;
    if (!fileName) return;
    try {
      const resolution = await resolveGgufFiles(model.origin);
      if (!resolution) return;
      const variant = resolution.variants.find((v) => v.fileName === fileName);
      if (!variant) return;
      handleDownloadSearchResult(buildFakeSearchResult(model, variant), variant);
    } catch {
      useStore.getState().updateSavedModelMeta(modelId, {
        storageState: 'partial', lastError: 'Failed to resolve model files for retry',
      });
    }
  }, [localModels, handleDownloadSearchResult]);

  const handleDeleteDownloadingModel = useCallback(async (modelId: string) => {
    await deleteWithConfirm(modelId, {
      abortControllers, clearProgress,
      onDeleted: () => {
        hfSearch.setActiveSearchDownloads((prev) => { const { [modelId]: _, ...rest } = prev; return rest; });
        bumpOpfsBrowser();
      },
    });
  }, [deleteWithConfirm, clearProgress, hfSearch.setActiveSearchDownloads, bumpOpfsBrowser]);

  const handleCancelDownloadingModel = useCallback((modelId: string) => {
    cancelDownload(modelId);
  }, [cancelDownload]);

  // ----- Derived state -----
  const importedStatus = importedModelId ? (runtimeStatuses[importedModelId] ?? localModelRuntime.getStatus(importedModelId)) : 'idle';
  const isEphemeralReady = importedStatus === 'ready' || importedStatus === 'busy';
  const canTestGenerate = isTestModelLoaded('generate');
  const canTestAnalyze = isTestModelLoaded('analyze') || isTestModelLoaded('generate');
  const showTestArea = canTestGenerate || canTestAnalyze;
  const analysisFallsBack = !analysisModelId && !!generationModelId;

  const tierLabels: Record<DeviceTier, string> = {
    low: t('localModel.deviceTierLow'),
    standard: t('localModel.deviceTierStandard'),
    high: t('localModel.deviceTierHigh'),
  };
  const taskLabels: Record<string, string> = {
    generation: t('localModel.taskGeneration'),
    analysis: t('localModel.taskAnalysis'),
  };

  return (
    <div className='flex flex-col gap-5'>
      {/* Experimental notice */}
      <div className='flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300'>
        <span className='font-semibold whitespace-nowrap'>{t('localModel.experimental')}</span>
        <InfoTooltip text={t('localModel.experimentalNote')} />
      </div>

      {/* 1. Enable toggle + device tier */}
      <SettingsGroup label=''>
        <div>
          <Toggle label={t('localModel.enabled')} isChecked={enabled} setIsChecked={setEnabledWithPreflight} />
          {enabled && (
            <div className='px-4 pb-3 -mt-1 flex flex-col gap-3 text-xs text-gray-500 dark:text-gray-400'>
              <div>
                {t('localModel.deviceTier')}: <span className='font-medium text-gray-700 dark:text-gray-300'>{tierLabels[deviceTier]}</span>
              </div>
              <label className='flex cursor-pointer items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2'>
                <span className='flex flex-col gap-0.5'>
                  <span className='text-sm font-medium text-gray-900 dark:text-gray-200'>{t('localModel.webgpuEnabled')}</span>
                  <span>{webGpuStatusText}</span>
                </span>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={resolvedWebGpuEnabled}
                  onChange={handleWebGpuToggle}
                />
                <span className="relative flex-shrink-0 w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-green-500/70" />
              </label>

              <div className='rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden'>
                <div className='flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 px-3 py-2'>
                  <button
                    type='button'
                    onClick={() => setShowFeatureChecklist((prev) => !prev)}
                    className='flex min-w-0 flex-1 items-center justify-between gap-3 text-left'
                  >
                    <span className='flex min-w-0 flex-col'>
                      <span className='text-sm font-medium text-gray-900 dark:text-gray-200'>{t('localModel.featureChecklist')}</span>
                    </span>
                    <span className='inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400'>
                      <span>{showFeatureChecklist ? t('localModel.featureChecklistHide') : t('localModel.featureChecklistShow')}</span>
                      <span
                        className={`inline-block text-xs transition-transform ${showFeatureChecklist ? 'rotate-90' : ''}`}
                        aria-hidden='true'
                      >
                        ▶
                      </span>
                    </span>
                  </button>
                  <InfoTooltip text={t('localModel.featureChecklistDescription')} />
                  <button
                    type='button'
                    onClick={() => { void runEnvironmentInspection(); }}
                    disabled={webGpuPreflighting}
                    className='rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-[11px] text-gray-700 dark:text-gray-200 disabled:opacity-50'
                  >
                    {t('localModel.featureChecklistRefresh')}
                  </button>
                </div>
                {showFeatureChecklist && (
                  <>
                    <div className='px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300'>
                      <div>{t('localModel.estimatedCurrentLimit')}: <span className='font-medium text-gray-900 dark:text-gray-100'>{envReport ? `${formatEstimatedGiB(envReport.estimates.currentAppGiB)} (${envReport.estimates.currentAppPath})` : '—'}</span></div>
                      <div>{t('localModel.estimatedCpuSingleThread')}: <span className='font-medium text-gray-900 dark:text-gray-100'>{envReport ? formatEstimatedGiB(envReport.estimates.cpuSingleThreadGiB) : '—'}</span></div>
                      <div>{t('localModel.estimatedWebGpuSingleThread')}: <span className='font-medium text-gray-900 dark:text-gray-100'>{envReport ? formatEstimatedGiB(envReport.estimates.webgpuSingleThreadGiB) : '—'}</span></div>
                      <div>{t('localModel.estimatedCpuMultiThread')}: <span className='font-medium text-gray-900 dark:text-gray-100'>{envReport ? formatEstimatedGiB(envReport.estimates.cpuMultiThreadGiB) : '—'}</span></div>
                      <div>{t('localModel.estimatedWebGpuMultiThread')}: <span className='font-medium text-gray-900 dark:text-gray-100'>{envReport ? formatEstimatedGiB(envReport.estimates.webgpuMultiThreadGiB) : '—'}</span></div>
                      <div className='flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>{t('localModel.deviceTier')}<InfoTooltip text={t('localModel.estimatedLimitNote')} /></div>
                    </div>

                    <div
                      data-testid='wasm-variant-override-panel'
                      className='px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-1 text-[11px] text-gray-600 dark:text-gray-300'
                    >
                      <label className='flex items-center gap-2'>
                        <span className='font-medium text-gray-900 dark:text-gray-100'>{t('localModel.wasmVariantOverrideLabel')}</span>
                        <select
                          data-testid='wasm-variant-override-select'
                          className='rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[11px] text-gray-900 dark:text-gray-100'
                          value={wasmVariantOverride}
                          onChange={(e) => {
                            const next = e.target.value as WasmVariantOverride;
                            setWasmVariantOverrideState(next);
                            localModelRuntime.setWasmVariantOverride(next);
                          }}
                        >
                          <option value='auto'>{t('localModel.wasmVariantAuto')}</option>
                          <option value='st-cpu-compat'>st-cpu-compat</option>
                          <option value='mt-cpu-compat'>mt-cpu-compat</option>
                          <option value='st-cpu-mem64'>st-cpu-mem64 (Memory64)</option>
                          <option value='mt-cpu-mem64'>mt-cpu-mem64 (Memory64)</option>
                          <option value='st-webgpu-jspi-compat'>st-webgpu-jspi-compat</option>
                          <option value='mt-webgpu-jspi-compat'>mt-webgpu-jspi-compat</option>
                        </select>
                      </label>
                      <div className='flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>{t('localModel.featureChecklist')}<InfoTooltip text={t('localModel.wasmVariantOverrideNote')} /></div>
                    </div>

                    <div className='overflow-x-auto'>
                      <table className='min-w-full text-left text-[11px]'>
                        <thead className='bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300'>
                          <tr>
                            <th className='px-3 py-2 font-medium'>{t('localModel.featureColumn')}</th>
                            <th className='px-3 py-2 font-medium'>{t('localModel.statusColumn')}</th>
                            <th className='px-3 py-2 font-medium'>{t('localModel.detailColumn')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {featureRows.map((row, index) => {
                            const tone = row.check.state === 'ok'
                              ? 'bg-green-500'
                              : row.check.state === 'unknown'
                                ? 'bg-amber-400'
                                : 'bg-red-500';
                            const label = row.check.state === 'ok'
                              ? t('localModel.featureStatusOk')
                              : row.check.state === 'unknown'
                                ? t('localModel.featureStatusUnknown')
                                : t('localModel.featureStatusNo');
                            const showCategory = index === 0 || featureRows[index - 1].category !== row.category;
                            return (
                              <React.Fragment key={row.key}>
                                {showCategory && (
                                  <tr className='border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'>
                                    <td colSpan={3} className='px-3 py-2 font-medium text-gray-700 dark:text-gray-200'>
                                      {row.category}
                                    </td>
                                  </tr>
                                )}
                                <tr className='border-t border-gray-200 dark:border-gray-700 align-top'>
                                  <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                                    {row.docUrl ? (
                                      <a
                                        href={row.docUrl}
                                        target='_blank'
                                        rel='noreferrer'
                                        className='underline underline-offset-2'
                                      >
                                        {row.label}
                                      </a>
                                    ) : (
                                      <span>{row.label}</span>
                                    )}
                                  </td>
                                  <td className='px-3 py-2 text-gray-900 dark:text-gray-100'>
                                    <span className='inline-flex items-center gap-2 whitespace-nowrap'>
                                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} />
                                      <span>{label}</span>
                                    </span>
                                  </td>
                                  <td className='px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-pre-line'>{row.check.detail}</td>
                                </tr>
                              </React.Fragment>
                            );
                          })}
                          {!envReport && (
                            <tr className='border-t border-gray-200 dark:border-gray-700'>
                              <td colSpan={3} className='px-3 py-3 text-gray-500 dark:text-gray-400'>
                                {webGpuPreflighting ? t('localModel.webgpuPreflightChecking') : <InfoTooltip text={t('localModel.featureChecklistDescription')} />}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </SettingsGroup>

      {enabled && (
        <>
          {/* Task Assignment */}
          {(localModels.length > 0 || Object.values(savedModelMeta).some((m) => m.storageState === 'saved')) && (
            <SettingsGroup label={t('localModel.taskAssignment')}>
              {ASSIGNABLE_TASKS.map((task) => {
                const currentId = activeLocalModels[task];
                const currentStatus = currentId ? (runtimeStatuses[currentId] ?? 'idle') : 'idle';
                const isCurrentLoaded = currentStatus === 'ready' || currentStatus === 'busy';
                return (
                  <TaskAssignmentRow
                    key={task} task={task} taskLabel={taskLabels[task] ?? task}
                    currentModelId={currentId} candidates={getTaskCandidates(task)}
                    isCurrentLoaded={isCurrentLoaded} onAssign={handleTaskAssign}
                    requiresLoadText={t('localModel.assignmentRequiresLoad') as string}
                  />
                );
              })}
              {analysisFallsBack && (
                <div className='px-4 py-2'>
                  <span className='text-xs text-gray-500 dark:text-gray-400 italic'>{t('localModel.analysisFallsBackToGeneration')}</span>
                </div>
              )}
            </SettingsGroup>
          )}

          {/* Test generation area */}
          {showTestArea && (
            <SettingsGroup label={t('localModel.testGenerate')}>
              <div className='px-4 py-3 flex flex-col gap-3'>
                <div className='flex gap-1 rounded-md bg-gray-100 dark:bg-gray-700 p-0.5'>
                  {(['generate', 'analyze', 'format'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                        testMode === mode
                          ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                      onClick={() => setTestMode(mode)}
                    >
                      {mode === 'generate' ? 'Generate' : mode === 'analyze' ? 'Analyze' : 'Format'}
                    </button>
                  ))}
                </div>

                <textarea
                  className='w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500'
                  rows={3}
                  placeholder={testMode === 'generate' ? (t('localModel.testPromptPlaceholder') as string) : 'Enter text...'}
                  value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={generating}
                />

                {testMode === 'analyze' && (
                  <input
                    type='text'
                    className='w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                    placeholder='Instruction (e.g. "Identify the key themes")'
                    value={analyzeInstruction} onChange={(e) => setAnalyzeInstruction(e.target.value)} disabled={generating}
                  />
                )}

                {testMode === 'format' && (
                  <select
                    className='w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                    value={formatPreset} onChange={(e) => setFormatPreset(e.target.value as typeof formatPreset)} disabled={generating}
                  >
                    <option value='summarize'>Summarize</option>
                    <option value='rewrite'>Rewrite</option>
                    <option value='bullets'>Bullet Points</option>
                  </select>
                )}

                <div className='flex gap-2'>
                  <button
                    className='btn btn-primary text-sm px-4 py-1.5'
                    onClick={testMode === 'generate' ? handleGenerate : testMode === 'analyze' ? handleAnalyze : handleFormat}
                    disabled={generating || !prompt.trim() || !isTestModelLoaded(testMode) || (testMode === 'analyze' && !analyzeInstruction.trim())}
                  >
                    {generating ? t('localModel.generating') : (testMode === 'generate' ? t('localModel.testGenerate') : testMode === 'analyze' ? 'Analyze' : 'Format')}
                  </button>
                  {generating && (
                    <button className='btn btn-neutral text-sm px-4 py-1.5' onClick={handleAbort}>Stop</button>
                  )}
                </div>

                {output && (
                  <div className='flex flex-col gap-1'>
                    <span className='text-xs font-medium text-gray-500 dark:text-gray-400'>{t('localModel.output')}</span>
                    <div
                      ref={outputRef}
                      className='max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono'
                    >
                      {output}
                    </div>
                  </div>
                )}
              </div>
            </SettingsGroup>
          )}

          {/* 2. Downloaded models list */}
          {(() => {
            const catalogIds = new Set(CURATED_MODELS.map((m) => m.id));
            const completedCatalog = CURATED_MODELS.filter((m) => savedModelMeta[m.id]?.storageState === 'saved');
            const completedSearch = localModels.filter((m) =>
              m.source === 'opfs' && !catalogIds.has(m.id) && savedModelMeta[m.id]?.storageState === 'saved');
            const hasAnyDownloaded = completedCatalog.length > 0 || completedSearch.length > 0;
            const anyLoading = selectedModelId ? (runtimeStatuses[selectedModelId] ?? 'idle') === 'loading' : false;
            const selectedAlreadyLoaded = selectedModelId ? ['ready', 'busy'].includes(runtimeStatuses[selectedModelId] ?? 'idle') : false;

            return (
              <SettingsGroup label={
                <div className='flex items-center justify-between w-full'>
                  <span>{t('localModel.downloadedModels')}</span>
                  {hasAnyDownloaded && (
                    <button
                      className='btn btn-primary text-xs px-3 py-1 normal-case tracking-normal font-normal disabled:opacity-50 disabled:cursor-not-allowed'
                      onClick={handleLoadSelected} disabled={!selectedModelId || anyLoading || selectedAlreadyLoaded}
                    >
                      {anyLoading ? t('localModel.modelStatus.loading') : t('localModel.load')}
                    </button>
                  )}
                </div>
              }>
                {!hasAnyDownloaded && (
                  <div className='px-4 py-6 text-center'>
                    <p className='text-xs text-gray-400 dark:text-gray-500'>{t('localModel.noDownloadedModels')}</p>
                  </div>
                )}
                {loadError && (
                  <div className='px-4 py-2 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap'>
                    {t('localModel.loadError')}: {loadError}
                  </div>
                )}
                {completedCatalog.map((model) => (
                  <DownloadedModelRow
                    key={model.id} modelId={model.id} label={model.label} tasks={model.tasks}
                    fileSize={model.expectedDownloadSize}
                    fitBadge={<FitBadge fit={getModelFit(model.recommendedDeviceTier, deviceTier)} />}
                    runtimeStatus={runtimeStatuses[model.id] ?? 'idle'}
                    isSelected={selectedModelId === model.id} onSelect={() => setSelectedModelId(model.id)}
                    isFavorite={favoriteLocalModelIds.includes(model.id)}
                    onToggleFavorite={() => toggleFavoriteLocalModel(model.id)}
                    onUnload={handleUnloadCatalogModel} onDelete={handleDeleteCatalogModel}
                  />
                ))}
                {completedSearch.map((model) => (
                  <DownloadedModelRow
                    key={model.id} modelId={model.id} label={model.label} tasks={model.tasks}
                    fileSize={model.fileSize}
                    runtimeStatus={runtimeStatuses[model.id] ?? 'idle'}
                    isSelected={selectedModelId === model.id} onSelect={() => setSelectedModelId(model.id)}
                    isFavorite={favoriteLocalModelIds.includes(model.id)}
                    onToggleFavorite={() => toggleFavoriteLocalModel(model.id)}
                    onUnload={handleUnloadSearchModel} onDelete={handleDeleteSearchModel}
                  />
                ))}
              </SettingsGroup>
            );
          })()}

          {/* 2.5. Downloading / partial models */}
          {(() => {
            const catalogIds = new Set(CURATED_MODELS.map((m) => m.id));
            const downloadingCatalog = CURATED_MODELS.filter((m) =>
              savedModelMeta[m.id]?.storageState === 'downloading' || savedModelMeta[m.id]?.storageState === 'partial');
            const downloadingSearch = localModels.filter((m) =>
              m.source === 'opfs' && !catalogIds.has(m.id) &&
              (savedModelMeta[m.id]?.storageState === 'downloading' || savedModelMeta[m.id]?.storageState === 'partial'));
            if (downloadingCatalog.length === 0 && downloadingSearch.length === 0) return null;

            return (
              <SettingsGroup label={t('localModel.downloadingModels')}>
                {downloadingCatalog.map((model) => (
                  <DownloadingModelRow
                    key={model.id} modelId={model.id} label={model.label} tasks={model.tasks}
                    fileSize={model.expectedDownloadSize} progress={downloadProgresses[model.id] ?? null}
                    meta={savedModelMeta[model.id]} isFavorite={favoriteLocalModelIds.includes(model.id)}
                    onToggleFavorite={() => toggleFavoriteLocalModel(model.id)}
                    onCancel={handleCancelDownloadingModel} onResume={handleResumeDownloadingModel}
                    onRetry={handleRetryDownloadingModel} onDelete={handleDeleteDownloadingModel}
                  />
                ))}
                {downloadingSearch.map((model) => (
                  <DownloadingModelRow
                    key={model.id} modelId={model.id} label={model.label} tasks={model.tasks}
                    fileSize={model.fileSize} progress={downloadProgresses[model.id] ?? null}
                    meta={savedModelMeta[model.id]} isFavorite={favoriteLocalModelIds.includes(model.id)}
                    onToggleFavorite={() => toggleFavoriteLocalModel(model.id)}
                    onCancel={handleCancelDownloadingModel} onResume={handleResumeDownloadingModel}
                    onRetry={handleRetryDownloadingModel} onDelete={handleDeleteDownloadingModel}
                  />
                ))}
              </SettingsGroup>
            );
          })()}

          {/* 3. Manual import */}
          <SettingsGroup label={t('localModel.importedFiles')}>
            <div className='px-4 py-3 flex flex-col gap-3'>
              <div className='flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>{t('localModel.importedFiles')}<InfoTooltip text={t('localModel.selectGgufHint')} /></div>
              <div className='flex items-center gap-3'>
                <label
                  className={`btn btn-neutral text-sm px-4 py-1.5 cursor-pointer${importedStatus === 'loading' ? ' opacity-50 pointer-events-none' : ''}`}
                >
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.gguf'
                    multiple
                    className='absolute w-0 h-0 overflow-hidden opacity-0'
                    onChange={handleFileSelect}
                    disabled={importedStatus === 'loading'}
                  />
                  {importedStatus === 'loading' ? t('localModel.modelStatus.loading') : t('localModel.selectGgufFile')}
                </label>
                {importedStatus !== 'idle' && <StatusBadge status={importedStatus} />}
              </div>
              {fileName && <div className='text-xs text-gray-600 dark:text-gray-400 truncate'>{fileName}</div>}
              {ephemeralLoadError && (
                <div className='text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap'>
                  {t('localModel.loadError')}: {ephemeralLoadError}
                </div>
              )}
              {isEphemeralReady && (
                <div className='flex items-center gap-2'>
                  {contextLength !== null && (
                    <span className='text-xs text-gray-500 dark:text-gray-400'>{t('localModel.contextLength')}: {contextLength.toLocaleString()}</span>
                  )}
                  <button className='btn btn-neutral text-xs px-3 py-1 ml-auto' onClick={handleUnloadEphemeral} disabled={generating}>
                    {t('localModel.unload')}
                  </button>
                </div>
              )}
            </div>
          </SettingsGroup>

          {/* Recommended models */}
          {CURATED_MODELS.filter((m) => savedModelMeta[m.id]?.storageState !== 'saved').length > 0 && (
            <SettingsGroup label={t('localModel.recommendedModels')}>
              {CURATED_MODELS.filter((m) => savedModelMeta[m.id]?.storageState !== 'saved').map((model) => (
                <CatalogCard
                  key={model.id} model={model} deviceTier={deviceTier} meta={savedModelMeta[model.id]}
                  runtimeStatus={runtimeStatuses[model.id] ?? 'idle'}
                  downloadProgress={downloadProgresses[model.id] ?? null}
                  resumeFallbackMessage={resumeFallbacks[model.id] ?? null}
                  isFavorite={favoriteLocalModelIds.includes(model.id)}
                  onToggleFavorite={() => toggleFavoriteLocalModel(model.id)}
                  onDownload={handleDownload} onCancel={handleCancelDownload}
                  onResume={handleResumeCatalog} onRetry={handleRetry}
                  onDelete={handleDeleteCatalogModel} onLoad={handleLoadCatalogModel}
                  onUnload={handleUnloadCatalogModel}
                />
              ))}
            </SettingsGroup>
          )}

          {/* OPFS Storage Management */}
          <SettingsGroup label={t('localModel.opfsBrowser.title')}>
            <div className='px-4 py-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>{t('localModel.opfsBrowser.title')}<InfoTooltip text={t('localModel.opfsBrowser.description')} /></div>
            <OpfsFileBrowser
              refreshTrigger={opfsBrowserRefresh}
              onStorageChanged={() => {
                setRehydrationEpoch((n) => n + 1);
                bumpOpfsBrowser();
              }}
            />
          </SettingsGroup>

          {/* 4. Hugging Face Search */}
          <SettingsGroup label=''>
            <div className='sticky -top-6 z-10 bg-gray-50 dark:bg-gray-700 rounded-t-lg'>
              <div className='flex items-center justify-between px-3 pt-2 pb-1'>
                <span className='text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider'>{t('localModel.hfSearch')}</span>
                <FilterInfoButton />
              </div>
              <div className='px-3 pb-2 flex items-center gap-2'>
                <div className='flex-1 relative'>
                  <input
                    type='text'
                    className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 pl-3 pr-8 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                    placeholder={t('localModel.hfSearchPlaceholder') as string}
                    value={hfSearch.searchQuery} onChange={(e) => hfSearch.setSearchQuery(e.target.value)}
                  />
                  {hfSearch.searchQuery && (
                    <button
                      className='absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                      onClick={() => { hfSearch.setSearchQuery(''); }}
                      type='button'
                    >&times;</button>
                  )}
                </div>
                <select
                  className='rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                  value={hfSearch.searchEngine} onChange={(e) => hfSearch.setSearchEngine(e.target.value as any)}
                >
                  <option value='all'>{t('localModel.engineAll')}</option>
                  <option value='wllama'>{t('localModel.engineWllama')}</option>
                  <option value='transformers.js'>{t('localModel.engineTransformersJs')}</option>
                </select>
                {hfSearch.searching && (
                  <span className='text-xs text-gray-500 whitespace-nowrap'>{t('localModel.hfSearching')}</span>
                )}
              </div>
              {hfSearch.hasSearchedOnce && hfSearch.searchResults.length > 0 && (
                <>
                  <div className='hidden sm:flex items-center gap-2 px-3 py-1 border-t border-gray-200 dark:border-gray-600'>
                    <span className='flex-1' />
                    <span className='text-[10px] font-medium text-gray-500 dark:text-gray-400'>{t('localModel.quantization')}</span>
                    <SortableColumnHeader className='inline' label={t('localModel.hfLastModified')} field='lastModified' width='w-20' currentSort={hfSearch.searchSort} currentDir={hfSearch.searchSortDir} onSort={(f, d) => { hfSearch.setSearchSort(f as any); hfSearch.setSearchSortDir(d); }} />
                    <SortableColumnHeader className='inline' label='DL' field='downloads' width='w-14' currentSort={hfSearch.searchSort} currentDir={hfSearch.searchSortDir} onSort={(f, d) => { hfSearch.setSearchSort(f as any); hfSearch.setSearchSortDir(d); }} />
                    <SortableColumnHeader className='inline' label='Size' field='size' width='w-16' currentSort={hfSearch.searchSort} currentDir={hfSearch.searchSortDir} onSort={(f, d) => { hfSearch.setSearchSort(f as any); hfSearch.setSearchSortDir(d); }} />
                  </div>
                  <div className='sm:hidden flex items-center justify-end gap-3 px-3 py-1 ml-5 border-t border-gray-200 dark:border-gray-600'>
                    <SortableColumnHeader className='inline' label={t('localModel.hfLastModified')} field='lastModified' width='' currentSort={hfSearch.searchSort} currentDir={hfSearch.searchSortDir} onSort={(f, d) => { hfSearch.setSearchSort(f as any); hfSearch.setSearchSortDir(d); }} />
                    <SortableColumnHeader className='inline' label='DL' field='downloads' width='' currentSort={hfSearch.searchSort} currentDir={hfSearch.searchSortDir} onSort={(f, d) => { hfSearch.setSearchSort(f as any); hfSearch.setSearchSortDir(d); }} />
                    <SortableColumnHeader className='inline' label='Size' field='size' width='' currentSort={hfSearch.searchSort} currentDir={hfSearch.searchSortDir} onSort={(f, d) => { hfSearch.setSearchSort(f as any); hfSearch.setSearchSortDir(d); }} />
                  </div>
                </>
              )}
              {hfSearch.hasSearchedOnce && !hfSearch.searching && hfSearch.searchResults.length === 0 && hfSearch.searchQuery.trim() && Object.keys(hfSearch.activeSearchDownloads).length === 0 && (
                <div className='px-4 py-3 text-xs text-gray-500 dark:text-gray-400 text-center'>{t('localModel.hfSearchNoResults')}</div>
              )}
            </div>

            <div style={hfSearch.hasSearchedOnce ? { minHeight: '800px' } : undefined}>
              {Object.values(hfSearch.activeSearchDownloads)
                .filter((d) => !hfSearch.searchResults.some((r) => r.repoId === d.result.repoId))
                .map((d) => {
                  const repoMetas: Record<string, any> = {};
                  const repoProgresses: Record<string, any> = {};
                  const repoStatuses: Record<string, any> = {};
                  if (savedModelMeta[d.modelId]) repoMetas[d.modelId] = savedModelMeta[d.modelId];
                  if (downloadProgresses[d.modelId]) repoProgresses[d.modelId] = downloadProgresses[d.modelId];
                  if (runtimeStatuses[d.modelId]) repoStatuses[d.modelId] = runtimeStatuses[d.modelId];
                  return (
                    <SearchResultCard
                      key={`active-${d.modelId}`} result={d.result}
                      variants={hfSearch.variantMap[d.result.repoId] ?? null} variantsLoading={false}
                      selectedFileName={d.variant.fileName} deviceTier={deviceTier}
                      savedMetas={repoMetas} progresses={repoProgresses} statuses={repoStatuses}
                      resumeFallbackMessage={resumeFallbacks[d.modelId] ?? null}
                      existingModelId={null} existingModelState={null}
                      onSelectVariant={hfSearch.handleSelectVariant}
                      onDownload={handleDownloadSearchResult} onResume={handleResumeSearchModel}
                      onRetry={handleRetrySearchModel} onCancel={handleCancelSearchDownload}
                      onLoad={handleLoadSearchModel} onUnload={handleUnloadSearchModel}
                      onDelete={handleDeleteSearchModel}
                    />
                  );
                })
              }

              {hfSearch.searchResults.map((result) => {
                const repoPrefix = `hf--${result.repoId.split('/').map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')).join('--')}--`;
                const repoMetas: Record<string, any> = {};
                const repoProgresses: Record<string, any> = {};
                const repoStatuses: Record<string, any> = {};
                for (const [id, meta] of Object.entries(savedModelMeta)) {
                  if (id.startsWith(repoPrefix)) repoMetas[id] = meta;
                }
                for (const [id, prog] of Object.entries(downloadProgresses)) {
                  if (id.startsWith(repoPrefix)) repoProgresses[id] = prog;
                }
                for (const [id, status] of Object.entries(runtimeStatuses)) {
                  if (id.startsWith(repoPrefix)) repoStatuses[id] = status;
                }
                const selectedFile = hfSearch.selectedVariants[result.repoId] ?? null;
                const selectedVar = hfSearch.variantMap[result.repoId]?.variants.find((v) => v.fileName === selectedFile);
                const selectedMid = selectedVar ? generateSearchModelId(result.repoId, selectedVar) : null;
                const fallbackMsg = selectedMid ? (resumeFallbacks[selectedMid] ?? null) : null;
                const existingId = selectedFile ? hfSearch.findExistingModelForVariant(result.repoId, selectedFile) : null;
                const existingState = existingId ? savedModelMeta[existingId]?.storageState : undefined;
                const isExistingActive = existingId != null && (
                  existingState === 'saved' || existingState === 'downloading' || !!abortControllers.current[existingId]
                );

                return (
                  <SearchResultCard
                    key={result.repoId} result={result}
                    variants={hfSearch.variantMap[result.repoId] ?? null}
                    variantsLoading={hfSearch.variantLoading[result.repoId] ?? false}
                    selectedFileName={selectedFile} deviceTier={deviceTier}
                    savedMetas={repoMetas} progresses={repoProgresses} statuses={repoStatuses}
                    resumeFallbackMessage={fallbackMsg}
                    existingModelId={isExistingActive ? existingId : null}
                    existingModelState={isExistingActive ? (existingState as 'saved' | 'downloading' | 'partial' | null) ?? null : null}
                    onSelectVariant={hfSearch.handleSelectVariant}
                    onDownload={handleDownloadSearchResult} onResume={handleResumeSearchModel}
                    onRetry={handleRetrySearchModel} onCancel={handleCancelSearchDownload}
                    onLoad={handleLoadSearchModel} onUnload={handleUnloadSearchModel}
                    onDelete={handleDeleteSearchModel}
                  />
                );
              })}

              {hfSearch.searchHasMore && hfSearch.searchResults.length > 0 && (
                <div ref={hfSearch.searchSentinelRef} className='px-4 py-2 text-center'>
                  {hfSearch.loadingMore && (
                    <span className='text-xs text-gray-500'>{t('localModel.hfSearching')}</span>
                  )}
                </div>
              )}
            </div>
          </SettingsGroup>
        </>
      )}
    </div>
  );
};

export default LocalModelSettings;
