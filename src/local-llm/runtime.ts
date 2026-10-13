import { localGenerationOptions } from '@utils/localGenerationOutput';
/**
 * LocalModelRuntime — manages the lifecycle of local LLM engine workers.
 *
 * UI code accesses engines exclusively through this class.
 * Each loaded model gets its own Web Worker; the runtime tracks status,
 * capabilities, and provides abort/busy guards.
 *
 * Status lifecycle: idle → loading → ready ⇄ busy → unloaded
 * Error can occur from loading or busy states.
 */

import type {
  LocalModelDefinition,
  LocalModelStatus,
  LocalModelCapabilities,
  LocalModelEngine,
  LocalModelManifest,
  LocalModelTask,
  GenerateOptions,
  ClassificationLabel,
  LocalModelBusyReason,
  SingleFileManifest,
  LoadDescriptor,
} from './types';
import type { ModelFileProvider } from './fileProvider';
import { getOPFSFileSize } from './storage';
import { CURATED_MODELS } from './catalog';
import { isLowbitQModelId } from './lowbit-q/lowbitQManager';
import { debugLog, debugReport } from '@store/debug-store';
import type { VariantOverride } from '../vendor/wllama/variant-table';

// ---------------------------------------------------------------------------
// Worker proxy interfaces (engine-specific facades)
// ---------------------------------------------------------------------------

export interface WllamaGenerateInput {
  messages: { role: string; content: string }[];
  assistantPrefix?: string;
}

/** Wrap a plain prompt string as a single-user-message WllamaGenerateInput. */
export function promptAsInput(prompt: string): WllamaGenerateInput {
  return { messages: [{ role: 'user', content: prompt }] };
}

export interface WllamaWorkerProxy {
  generate(input: WllamaGenerateInput, opts: GenerateOptions, onChunk: (text: string) => void, reason?: LocalModelBusyReason, signal?: AbortSignal): Promise<string>;
  abort(): void;
}

/** Identifies one caller that must keep models resident until it releases them. */
export type LocalModelOwnerId = string;

export interface LocalModelReservation {
  ownerId: LocalModelOwnerId;
  modelIds: readonly string[];
}

export type UnloadResult = 'unloaded' | 'reserved' | 'blocked';

export interface TransformersWorkerProxy {
  classify(text: string, reason?: LocalModelBusyReason, signal?: AbortSignal): Promise<ClassificationLabel[]>;
}

export interface RuntimeLogEvent {
  modelId: string;
  level: string;
  text: string;
  timestamp: number;
}

export interface RuntimeDiagnosticEvent {
  modelId: string;
  phase: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface RuntimeLoadProgressEvent {
  modelId: string;
  phase: string;
  percent: number;
  detail: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Internal engine entry
// ---------------------------------------------------------------------------

interface EngineEntry {
  worker: Worker;
  engine: LocalModelEngine;
  status: LocalModelStatus;
  capabilities: LocalModelCapabilities | null;
  /** Monotonically increasing request ID for the worker message protocol */
  nextId: number;
  /** Pending request resolvers keyed by request ID */
  pending: Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>;
  /** Current streaming chunk callback (for wllama generate) */
  onChunk: ((text: string) => void) | null;
  /** Abort flag — checked by the worker to stop generation */
  abortRequested: boolean;
  /** Why this model is currently busy (only meaningful when status === 'busy') */
  busyReason?: LocalModelBusyReason;
  /** Incremented before every generate/classify and when its worker is replaced. */
  epoch: number;
  activeRequestId: number | null;
  activeRequestEpoch: number | null;
  disposed?: boolean;
}

interface LoadModelOptions {
  forceDisableWebGPU?: boolean;
}

function formatDebugValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'fullText' && typeof value === 'string') {
      clone.fullTextLength = value.length;
    } else if (key === 'text' && typeof value === 'string') {
      clone.textLength = value.length;
    } else if (key === 'file' && value instanceof Blob) {
      clone[key] = {
        name: value instanceof File ? value.name : '(blob)',
        size: value.size,
        type: value.type,
      };
    } else if (key === 'files' && Array.isArray(value) && value.every((v) => v instanceof Blob)) {
      const blobs = value as Blob[];
      clone[key] = {
        count: blobs.length,
        totalSize: blobs.reduce((s, b) => s + b.size, 0),
        names: blobs.map((b) => (b instanceof File ? b.name : '(blob)')),
      };
    } else if (key === 'fileEntries' && Array.isArray(value)) {
      clone[key] = value.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const obj = entry as Record<string, unknown>;
        const file = obj.file;
        return {
          ...obj,
          file: file instanceof Blob ? {
            name: file instanceof File ? file.name : '(blob)',
            size: file.size,
            type: file.type,
          } : file,
        };
      });
    } else if (typeof value === 'string' && value.length > 500) {
      clone[key] = `${value.slice(0, 500)}... (${value.length} chars)`;
    } else {
      clone[key] = value;
    }
  }
  return formatDebugValue(clone);
}

/**
 * Firefox detection for WebGPU backend suppression.
 *
 * Reason: ggml-webgpu WGSL shaders (quant unpack paths in
 * vendor/wllama-src/llama.cpp/ggml/src/ggml-webgpu/wgsl-shaders/*.tmpl.wgsl —
 * Q4_0/Q5_0/Q8_0/Q3_K/Q6_K/IQ2/IQ3/IQ4 等 60+ 箇所) use
 * `bitcast<u32>(vec2<f16>(...))`. WGSL spec 上は合法
 * (https://www.w3.org/TR/WGSL/#bit-reinterp-builtin-functions) だが
 * Chromium/Tint のみ実装済みで Firefox/Naga は未実装のため拒否される。
 * 上流 tracking: https://github.com/gfx-rs/wgpu/issues/8896
 * (2026-04 時点で IR リファクタ途中・修正見込み未定。reporter 自身が
 * 「bitcast から脱却する」方向を示唆)。関連: gfx-rs/wgpu#4403。
 * Bugzilla に独立報告なし (Mozilla は wgpu 上流待ち)。
 *
 * 本修正が入るまで Firefox は CPU パスに固定し、>2GB アドレッシングの
 * ため preferMemory64 を維持する。
 *
 * How to apply: call before passing allowWebGPU / preferMemory64 to the
 * worker. Safe no-op outside browsers (ua falsy).
 */
function isFirefoxRuntime(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Firefox\//.test(ua);
}

/**
 * Compute the total byte size of a wllama model definition.
 * Used for preferMemory64 determination in OPFS-direct mode (no File[] available).
 *
 * Trust order:
 *  1. manifest.totalSize — gguf-sharded always has this
 *  2. def.fileSize — stored in Zustand/IDB
 *  3. getOPFSFileSize() — last-resort OPFS lookup for single-file models
 */
async function computeModelTotalSize(def: LocalModelDefinition): Promise<number> {
  if (def.manifest.kind === 'gguf-sharded') {
    return def.manifest.totalSize;
  }
  if (def.fileSize) {
    return def.fileSize;
  }
  // single-file OPFS fallback
  try {
    return await getOPFSFileSize(def.id, (def.manifest as SingleFileManifest).entrypoint);
  } catch {
    return 0;
  }
}

function emitRuntimeDebugLog(modelId: string, level: string, message: string, timestamp = Date.now()): void {
  debugLog({
    source: `llm:${formatModelLogName(modelId)}`,
    level,
    message,
    timestamp,
  });
}

function shouldLogWorkerInfo(text: string): boolean {
  return !(
    text.startsWith('worker: [wllamaWorker] generate start')
    || text.startsWith('worker: [wllamaWorker] generate done')
  );
}

function formatModelLogName(modelId: string): string {
  const preflightPrefix = '__wllama_webgpu_preflight__:';
  if (modelId.startsWith(preflightPrefix)) return 'webgpu-preflight';

  const localFileMatch = modelId.match(/^local-file--[^-]+--(.+)$/);
  if (localFileMatch) return localFileMatch[1];

  const trimmed = modelId.replace(/^local-file--/, '');
  return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed;
}

// ---------------------------------------------------------------------------
// WASM capabilities (in-memory only — not persisted to store)
// ---------------------------------------------------------------------------

export interface WasmCapabilities {
  webgpu: boolean;
  memory64: boolean;
  multiThread: boolean;
}

export type WllamaFeatureState = 'ok' | 'no' | 'unknown';

export interface WllamaFeatureCheck {
  state: WllamaFeatureState;
  detail: string;
}

export interface WllamaEnvironmentReport {
  checks: {
    secureContext: WllamaFeatureCheck;
    memory64: WllamaFeatureCheck;
    jspi: WllamaFeatureCheck;
    exnref: WllamaFeatureCheck;
    sharedArrayBuffer: WllamaFeatureCheck;
    crossOriginIsolated: WllamaFeatureCheck;
    multiThread: WllamaFeatureCheck;
    webgpuApi: WllamaFeatureCheck;
    requestAdapter: WllamaFeatureCheck;
    shaderF16: WllamaFeatureCheck;
    requestDevice: WllamaFeatureCheck;
    webgpuPreflight: WllamaFeatureCheck;
  };
  estimates: {
    cpuSingleThreadGiB: number;
    cpuMultiThreadGiB: number | null;
    webgpuSingleThreadGiB: number | null;
    webgpuMultiThreadGiB: number | null;
    currentAppGiB: number;
    currentAppPath: string;
  };
}

// ---------------------------------------------------------------------------
// LocalModelRuntime
// ---------------------------------------------------------------------------

export type { VariantOverride as WasmVariantOverride } from '../vendor/wllama/variant-table';

export class LocalModelRuntime {
  private engines = new Map<string, EngineEntry>();
  private loadPromises = new Map<string, Promise<void>>();
  private ownerModels = new Map<LocalModelOwnerId, Set<string>>();
  private modelOwners = new Map<string, Set<LocalModelOwnerId>>();
  private ownerCancellation = new Map<LocalModelOwnerId, {
    cancelled: boolean;
    reject?: (reason: unknown) => void;
    onCancel?: () => void | Promise<void>;
  }>();
  private removalIntents = new Set<string>();
  private wasmCaps = new Map<string, WasmCapabilities>();
  private webGpuEnabled: boolean | null = null;
  private wasmVariantOverride: VariantOverride = 'auto';
  private listeners = new Set<() => void>();
  private logListeners = new Set<(event: RuntimeLogEvent) => void>();
  private diagnosticListeners = new Set<(event: RuntimeDiagnosticEvent) => void>();
  private loadProgressListeners = new Set<(event: RuntimeLoadProgressEvent) => void>();

  // -------------------------------------------------------------------------
  // Status queries
  // -------------------------------------------------------------------------

  getStatus(modelId: string): LocalModelStatus {
    return this.engines.get(modelId)?.status ?? 'idle';
  }

  isLoaded(modelId: string): boolean {
    const s = this.getStatus(modelId);
    return s === 'ready' || s === 'busy';
  }

  isBusy(modelId: string): boolean {
    return this.getStatus(modelId) === 'busy';
  }

  getBusyReason(modelId: string): LocalModelBusyReason | undefined {
    return this.engines.get(modelId)?.busyReason;
  }

  getCapabilities(modelId: string): LocalModelCapabilities | null {
    return this.engines.get(modelId)?.capabilities ?? null;
  }

  getWasmCapabilities(modelId: string): WasmCapabilities | null {
    return this.wasmCaps.get(modelId) ?? null;
  }

  getWebGpuEnabled(): boolean | null {
    return this.webGpuEnabled;
  }

  setWebGpuEnabled(enabled: boolean | null): void {
    this.webGpuEnabled = enabled;
  }

  getWasmVariantOverride(): VariantOverride {
    return this.wasmVariantOverride;
  }

  setWasmVariantOverride(override: VariantOverride): void {
    this.wasmVariantOverride = override;
  }

  reserve(ownerId: LocalModelOwnerId, modelIds: readonly string[]): LocalModelReservation {
    if (this.ownerCancellation.get(ownerId)?.cancelled) {
      throw new DOMException('Local model owner cancelled', 'AbortError');
    }
    const ids = [...new Set(modelIds.filter(Boolean))];
    let owned = this.ownerModels.get(ownerId);
    if (!owned) {
      owned = new Set();
      this.ownerModels.set(ownerId, owned);
    }
    for (const modelId of ids) {
      if (owned.has(modelId)) continue;
      owned.add(modelId);
      let owners = this.modelOwners.get(modelId);
      if (!owners) {
        owners = new Set();
        this.modelOwners.set(modelId, owners);
      }
      owners.add(ownerId);
    }
    return { ownerId, modelIds: ids };
  }

  release(ownerId: LocalModelOwnerId): void {
    const owned = this.ownerModels.get(ownerId);
    if (!owned) return;
    for (const modelId of owned) {
      const owners = this.modelOwners.get(modelId);
      owners?.delete(ownerId);
      if (owners?.size === 0) this.modelOwners.delete(modelId);
    }
    this.ownerModels.delete(ownerId);
    this.ownerCancellation.delete(ownerId);
  }

  registerOwnerCancellation(ownerId: LocalModelOwnerId, onCancel: () => void | Promise<void>): () => void {
    const state = this.ownerCancellation.get(ownerId) ?? { cancelled: false };
    if (state.cancelled) {
      void onCancel();
      return () => {};
    }
    state.onCancel = onCancel;
    this.ownerCancellation.set(ownerId, state);
    return () => {
      if (this.ownerCancellation.get(ownerId)?.onCancel === onCancel) {
        this.ownerCancellation.get(ownerId)!.onCancel = undefined;
      }
    };
  }

  cancelOwner(ownerId: LocalModelOwnerId): void {
    const state = this.ownerCancellation.get(ownerId) ?? { cancelled: false };
    if (state.cancelled) return;
    state.cancelled = true;
    state.reject?.(new DOMException('Local model owner cancelled', 'AbortError'));
    try { void state.onCancel?.(); } catch { /* cancellation is best-effort */ }
    this.ownerCancellation.set(ownerId, state);
    this.releaseReservation(ownerId);
  }

  private releaseReservation(ownerId: LocalModelOwnerId): void {
    const owned = this.ownerModels.get(ownerId);
    if (!owned) return;
    for (const modelId of owned) {
      const owners = this.modelOwners.get(modelId);
      owners?.delete(ownerId);
      if (owners?.size === 0) this.modelOwners.delete(modelId);
    }
    this.ownerModels.delete(ownerId);
  }

  private clearModelReservations(modelId: string): void {
    const owners = this.modelOwners.get(modelId);
    if (!owners) return;
    for (const ownerId of [...owners]) this.cancelOwner(ownerId);
  }

  isReserved(modelId: string): boolean {
    return (this.modelOwners.get(modelId)?.size ?? 0) > 0;
  }

  beginAssetRemoval(modelId: string): void {
    this.removalIntents.add(modelId);
  }

  endAssetRemoval(modelId: string): void {
    this.removalIntents.delete(modelId);
  }

  private ownerCancellationPromise(ownerId: LocalModelOwnerId): Promise<never> {
    const state = this.ownerCancellation.get(ownerId) ?? { cancelled: false };
    if (state.cancelled) return Promise.reject(new DOMException('Local model owner cancelled', 'AbortError'));
    const promise = new Promise<never>((_resolve, reject) => {
      state.reject = reject;
    });
    this.ownerCancellation.set(ownerId, state);
    return promise;
  }

  private async awaitForOwner<T>(promise: Promise<T>, ownerId?: LocalModelOwnerId): Promise<T> {
    if (!ownerId) return promise;
    return Promise.race([promise, this.ownerCancellationPromise(ownerId)]);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async preflightWllamaWebGPU(): Promise<boolean> {
    const modelId = `__wllama_webgpu_preflight__:${Date.now()}`;
    const worker = this.createWorker('wllama');
    const entry: EngineEntry = {
      worker,
      engine: 'wllama',
      status: 'loading',
      capabilities: null,
      nextId: 1,
      pending: new Map(),
      onChunk: null,
      abortRequested: false,
      epoch: 0,
      activeRequestId: null,
      activeRequestEpoch: null,
    };
    this.engines.set(modelId, entry);

    worker.onmessage = (ev: MessageEvent) => {
      this.handleWorkerMessage(modelId, ev.data);
    };

    worker.onerror = (err: ErrorEvent) => {
      for (const [, p] of entry.pending) {
        p.reject(new Error(err.message));
      }
      entry.pending.clear();
    };

    try {
      if (isFirefoxRuntime()) {
        // Firefox: ggml-webgpu WGSL shaders fail Naga validation; skip preflight.
        return false;
      }
      this.emitDiagnostic({
        modelId,
        phase: 'runtime-webgpu-preflight-request',
        timestamp: Date.now(),
        payload: { allowWebGPU: true },
      });
      await this.sendRequest(modelId, {
        type: 'init',
        isLowbitQ: false,
        preferMemory64: false,
        allowWebGPU: true,
      });
      if (this.wasmCaps.get(modelId)?.webgpu !== true) return false;
      await this.sendRequest(modelId, { type: 'preflightLoadRuntime' });
      return true;
    } catch (e) {
      console.warn('[LocalModelRuntime] WebGPU preflight failed:', (e as Error).message);
      return false;
    } finally {
      worker.terminate();
      for (const [, p] of entry.pending) {
        p.reject(new Error('WebGPU preflight worker terminated'));
      }
      entry.pending.clear();
      this.engines.delete(modelId);
      this.wasmCaps.delete(modelId);
    }
  }

  async inspectWllamaEnvironment(): Promise<WllamaEnvironmentReport> {
    const modelId = `__wllama_env_check__:${Date.now()}`;
    const worker = this.createWorker('wllama');
    const entry: EngineEntry = {
      worker,
      engine: 'wllama',
      status: 'loading',
      capabilities: null,
      nextId: 1,
      pending: new Map(),
      onChunk: null,
      abortRequested: false,
      epoch: 0,
      activeRequestId: null,
      activeRequestEpoch: null,
    };
    this.engines.set(modelId, entry);

    worker.onmessage = (ev: MessageEvent) => {
      this.handleWorkerMessage(modelId, ev.data);
    };

    worker.onerror = (err: ErrorEvent) => {
      for (const [, p] of entry.pending) {
        p.reject(new Error(err.message));
      }
      entry.pending.clear();
    };

    try {
      const raw = await this.sendRequest(modelId, {
        type: 'inspectRuntimeFeatures',
      }) as {
        checks: WllamaEnvironmentReport['checks'];
      };

      const report: WllamaEnvironmentReport = {
        checks: {
          ...raw.checks,
          webgpuPreflight: {
            state: 'unknown',
            detail: '未実施',
          },
        },
        estimates: {
          cpuSingleThreadGiB: 0,
          cpuMultiThreadGiB: null,
          webgpuSingleThreadGiB: null,
          webgpuMultiThreadGiB: null,
          currentAppGiB: 0,
          currentAppPath: '',
        },
      };

      const canAttemptPreflight =
        !isFirefoxRuntime() &&
        report.checks.jspi.state === 'ok' &&
        report.checks.exnref.state === 'ok' &&
        report.checks.requestDevice.state === 'ok';

      if (canAttemptPreflight) {
        try {
          await this.sendRequest(modelId, {
            type: 'init',
            isLowbitQ: false,
            preferMemory64: report.checks.memory64.state === 'ok',
            allowWebGPU: true,
          });
          await this.sendRequest(modelId, { type: 'preflightLoadRuntime' });
          report.checks.webgpuPreflight = {
            state: 'ok',
            detail: 'wllama WebGPU ランタイムの簡易ロードに成功',
          };
        } catch (e) {
          report.checks.webgpuPreflight = {
            state: 'no',
            detail: (e as Error).message,
          };
        }
      } else if (isFirefoxRuntime()) {
        report.checks.webgpuPreflight = {
          state: 'no',
          detail: 'Firefox: ggml-webgpu WGSL の bitcast<u32>(vec2<f16>) が Naga 未実装のため不可 (WGSL spec 上は合法、Chromium/Tint のみ実装)。上流 issue: https://github.com/gfx-rs/wgpu/issues/8896。CPU パスで動作します。',
        };
      } else {
        const blocker = [
          report.checks.jspi.state !== 'ok' ? 'JSPI' : null,
          report.checks.exnref.state !== 'ok' ? 'exnref' : null,
          report.checks.requestDevice.state !== 'ok' ? 'requestDevice' : null,
        ].filter(Boolean).join(', ');
        report.checks.webgpuPreflight = {
          state: 'unknown',
          detail: blocker ? `前提未充足: ${blocker}` : '前提未充足',
        };
      }

      const hasMemory64 = report.checks.memory64.state === 'ok';
      const hasMultiThread = report.checks.multiThread.state === 'ok';
      const hasWebGpuRuntime = report.checks.webgpuPreflight.state === 'ok';

      report.estimates.cpuSingleThreadGiB = hasMemory64 ? 16 : 2;
      report.estimates.cpuMultiThreadGiB = hasMultiThread ? (hasMemory64 ? 16 : 2) : null;
      report.estimates.webgpuSingleThreadGiB = hasWebGpuRuntime ? (hasMemory64 ? 16 : 4) : null;
      report.estimates.webgpuMultiThreadGiB = (hasWebGpuRuntime && hasMultiThread)
        ? (hasMemory64 ? 16 : 2)
        : null;

      const currentWebGpuGiB = report.estimates.webgpuSingleThreadGiB ?? 0;
      if (currentWebGpuGiB > report.estimates.cpuSingleThreadGiB) {
        report.estimates.currentAppGiB = currentWebGpuGiB;
        report.estimates.currentAppPath = 'WebGPU 単スレッド';
      } else if (currentWebGpuGiB === report.estimates.cpuSingleThreadGiB && currentWebGpuGiB > 0) {
        report.estimates.currentAppGiB = currentWebGpuGiB;
        report.estimates.currentAppPath = hasWebGpuRuntime
          ? 'CPU 単スレッド / WebGPU 単スレッド'
          : 'CPU 単スレッド';
      } else {
        report.estimates.currentAppGiB = report.estimates.cpuSingleThreadGiB;
        report.estimates.currentAppPath = 'CPU 単スレッド';
      }

      return report;
    } finally {
      worker.terminate();
      for (const [, p] of entry.pending) {
        p.reject(new Error('Environment inspection worker terminated'));
      }
      entry.pending.clear();
      this.engines.delete(modelId);
      this.wasmCaps.delete(modelId);
    }
  }

  async loadModel(def: LocalModelDefinition, provider: ModelFileProvider, options: LoadModelOptions = {}): Promise<void> {
    if (this.removalIntents.has(def.id)) {
      throw new DOMException(`Model ${def.id} is being removed`, 'AbortError');
    }
    if (this.isLoaded(def.id)) return;
    const existing = this.loadPromises.get(def.id);
    if (existing) return existing;
    const loading = this.loadModelImpl(def, provider, options);
    this.loadPromises.set(def.id, loading);
    try {
      await loading;
    } finally {
      if (this.loadPromises.get(def.id) === loading) this.loadPromises.delete(def.id);
    }
  }

  private async loadModelImpl(def: LocalModelDefinition, provider: ModelFileProvider, options: LoadModelOptions = {}): Promise<void> {

    const worker = this.createWorker(def.engine);
    const entry: EngineEntry = {
      worker,
      engine: def.engine,
      status: 'loading',
      capabilities: null,
      nextId: 1,
      pending: new Map(),
      onChunk: null,
      abortRequested: false,
      epoch: 0,
      activeRequestId: null,
      activeRequestEpoch: null,
    };
    this.engines.set(def.id, entry);
    this.notifyListeners();

    worker.onmessage = (ev: MessageEvent) => {
      this.handleWorkerMessage(def.id, ev.data);
    };

    worker.onerror = (err: ErrorEvent) => {
      this.setStatus(def.id, 'error');
      // Reject all pending requests
      for (const [, p] of entry.pending) {
        p.reject(new Error(err.message));
      }
      entry.pending.clear();
    };

    try {
      let descriptor: LoadDescriptor | null = null;
      let preferMemory64 = false;
      let allowWebGPU = false;
      if (def.engine === 'wllama') {
        const isOpfsDirect = def.source === 'opfs' &&
          (def.manifest.kind === 'single-file' || def.manifest.kind === 'gguf-sharded');

        if (isOpfsDirect) {
          // OPFS-direct: inner worker reads via SyncAccessHandle, no File[] copy to WASM heap
          const shards = def.manifest.kind === 'gguf-sharded'
            ? def.manifest.shards
            : [def.manifest.entrypoint];
          descriptor = { mode: 'opfs-direct', modelId: def.id, shards };
          const totalSize = await computeModelTotalSize(def);
          preferMemory64 = totalSize >= 2 * 1024 * 1024 * 1024;
        } else {
          // wllama engine only accepts OPFS-backed models. Non-OPFS sources
          // (e.g. persistent-handle) are not supported for this engine.
          throw new Error(
            `wllama engine requires an OPFS-backed provider (source='opfs'), got source='${def.source}'`,
          );
        }

        const webGpuSetting = this.webGpuEnabled;
        allowWebGPU = !options.forceDisableWebGPU && webGpuSetting !== false;

        if (isFirefoxRuntime() && allowWebGPU) {
          // Firefox: ggml-webgpu WGSL incompatible with Naga; fall back to CPU.
          // Prefer Memory64 to keep >2GB addressing for larger models.
          allowWebGPU = false;
          preferMemory64 = true;
        }
      }

      // Init worker — pass flags so the worker can select the right WASM.
      const isLowbitQ = def.engine === 'wllama' && isLowbitQModelId(def.id);
      const wasmVariantOverride = def.engine === 'wllama' ? this.wasmVariantOverride : 'auto';
      this.emitDiagnostic({
        modelId: def.id,
        phase: 'runtime-init-request',
        timestamp: Date.now(),
        payload: {
          engine: def.engine,
          isLowbitQ,
          preferMemory64,
          allowWebGPU,
          wasmVariantOverride,
          forceDisableWebGPU: options.forceDisableWebGPU === true,
          webGpuSetting: this.webGpuEnabled,
          loadMode: descriptor?.mode ?? null,
        },
      });
      console.info('[LocalModelRuntime] init worker for', def.id, 'engine:', def.engine, 'isLowbitQ:', isLowbitQ, 'preferMemory64:', preferMemory64, 'allowWebGPU:', allowWebGPU, 'wasmVariantOverride:', wasmVariantOverride, 'loadMode:', descriptor?.mode);
      await this.sendRequest(def.id, { type: 'init', isLowbitQ, preferMemory64, allowWebGPU, wasmVariantOverride });
      console.info('[LocalModelRuntime] init done for', def.id);

      // Load model — engine-specific
      if (def.engine === 'wllama') {
        if (!descriptor) throw new Error('wllama load descriptor not set');
        const shardCount = descriptor.shards.length;
        const shardInfo = shardCount > 1 ? ` (${shardCount} shards)` : '';
        const nameHint = descriptor.shards[0];
        console.info('[LocalModelRuntime] loading model:', nameHint, shardInfo, 'mode: opfs-direct');
        // Look up expected context length from catalog/store so the worker
        // allocates the right amount of KV cache instead of a fixed default.
        const expectedCtx = this.lookupExpectedContextLength(def.id);
        const result = await this.sendRequest(def.id, {
          type: 'load', descriptor, ...(expectedCtx ? { expectedContextLength: expectedCtx } : {}),
        }) as {
          contextLength?: number;
          nativeContextLength?: number;
        };
        console.info('[LocalModelRuntime] model loaded, contextLength:', result?.contextLength, 'nativeContextLength:', result?.nativeContextLength);
        entry.capabilities = {
          contextLength: result?.contextLength,
          nativeContextLength: result?.nativeContextLength,
          supportsStreaming: true,
          engine: 'wllama',
        };
        // Persist discovered context length to the store so modelLookup can use it
        this.persistContextLength(def.id, result?.contextLength, result?.nativeContextLength);
      } else {
        // Transformers.js — send file entries to worker for customCache
        const fileEntries = await provider.getFileEntries();
        await this.sendRequest(def.id, {
          type: 'loadClassifier',
          modelId: def.origin,
          fileEntries,
        });
        entry.capabilities = {
          supportsStreaming: false,
          engine: 'transformers.js',
        };
      }

      this.setStatus(def.id, 'ready');
    } catch (e) {
      if (entry.disposed || this.removalIntents.has(def.id)) {
        throw new DOMException('Model loading cancelled', 'AbortError');
      }
      const selectedWebGPU = this.wasmCaps.get(def.id)?.webgpu === true;
      console.error('[LocalModelRuntime] loadModel failed for', def.id, ':', (e as Error).message);
      this.setStatus(def.id, 'error');
      if (def.engine === 'wllama' && selectedWebGPU && !options.forceDisableWebGPU) {
        this.emitDiagnostic({
          modelId: def.id,
          phase: 'runtime-webgpu-fallback',
          timestamp: Date.now(),
          payload: {
            reason: (e as Error).message,
          },
        });
        console.warn('[LocalModelRuntime] WebGPU load failed for', def.id, 'retrying with CPU WASM');
        emitRuntimeDebugLog(def.id, 'warn', 'WebGPU load failed; retrying this load with CPU WASM without changing the WebGPU setting');
        worker.terminate();
        entry.pending.clear();
        this.engines.delete(def.id);
        this.wasmCaps.delete(def.id);
        this.notifyListeners();
        await this.loadModelImpl(def, provider, { forceDisableWebGPU: true });
        return;
      }
      throw e;
    }
  }

  async unloadModel(modelId: string, options: { force?: boolean } = {}): Promise<UnloadResult> {
    if (options.force) this.clearModelReservations(modelId);
    const entry = this.engines.get(modelId);
    if (!entry) return 'unloaded';
    if (!options.force && this.isReserved(modelId)) return 'reserved';
    if (entry.status === 'loading') {
      if (!options.force) return 'blocked';
      entry.disposed = true;
      entry.worker.terminate();
      const abortError = new DOMException('Model unloaded while loading', 'AbortError');
      for (const [, pending] of entry.pending) pending.reject(abortError);
      entry.pending.clear();
      this.engines.delete(modelId);
      this.wasmCaps.delete(modelId);
      const loading = this.loadPromises.get(modelId);
      if (loading) {
        try { await loading; } catch { /* expected cancellation */ }
      }
      this.notifyListeners();
      return 'unloaded';
    }
    if (entry.status === 'busy') this.abort(modelId);

    try {
      await this.sendRequest(modelId, { type: 'unload' });
    } catch {
      return 'blocked';
    }

    entry.worker.terminate();
    entry.pending.clear();
    entry.epoch++;
    entry.activeRequestId = null;
    entry.activeRequestEpoch = null;
    this.engines.delete(modelId);
    this.notifyListeners();
    return 'unloaded';
  }

  async stopForAssetRemoval(modelId: string): Promise<UnloadResult> {
    this.beginAssetRemoval(modelId);
    return this.unloadModel(modelId, { force: true });
  }

  abort(modelId: string): void {
    const entry = this.engines.get(modelId);
    if (!entry || entry.status !== 'busy') return;
    entry.abortRequested = true;
    entry.epoch++;
    entry.activeRequestId = null;
    entry.activeRequestEpoch = null;
    // Send abort message to worker
    entry.worker.postMessage({ id: 0, type: 'abort' });
    // Reject all pending generate requests immediately so the generate()
    // proxy doesn't hang waiting for the worker response.  The worker will
    // still process the abort and send a 'done' message, but by then the
    // pending map is already empty so the late response is silently ignored.
    const abortError = new DOMException('Generation aborted', 'AbortError');
    for (const [id, pending] of entry.pending) {
      entry.pending.delete(id);
      pending.reject(abortError);
    }
  }

  /**
   * Ensure a model is loaded and ready. If already loaded, returns immediately.
   * If currently loading, waits for the load to complete.
   * Otherwise, looks up the model definition and loads it from OPFS.
   */
  async ensureLoaded(modelId: string, ownerId?: LocalModelOwnerId): Promise<void> {
    if (this.removalIntents.has(modelId)) {
      throw new DOMException(`Model ${modelId} is being removed`, 'AbortError');
    }
    if (ownerId) this.reserve(ownerId, [modelId]);
    if (this.isLoaded(modelId)) return;

    const status = this.getStatus(modelId);
    if (status === 'loading') {
      const existing = this.loadPromises.get(modelId);
      return this.awaitForOwner(existing ?? this.waitForLoad(modelId), ownerId);
    }

    const def = findModelDefinition(modelId);
    if (!def) throw new Error(`Model ${modelId} not found in store or catalog`);

    // Import OpfsFileProvider lazily to avoid circular dependency
    const { OpfsFileProvider } = await import('./storage');
    const provider = new OpfsFileProvider(modelId, def.manifest);
    await this.awaitForOwner(this.loadModel(def, provider), ownerId);
  }

  /**
   * Wait for a model that is currently loading to become ready.
   */
  private waitForLoad(modelId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const unsub = this.subscribe(() => {
        const s = this.getStatus(modelId);
        if (s === 'ready' || s === 'busy') {
          unsub();
          resolve();
        } else if (s === 'error' || s === 'idle' || s === 'unloaded') {
          unsub();
          reject(new Error(`Model ${modelId} failed to load (status: ${s})`));
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Engine-specific proxies
  // -------------------------------------------------------------------------

  getWllamaEngine(modelId: string): WllamaWorkerProxy | null {
    const entry = this.engines.get(modelId);
    if (!entry || entry.engine !== 'wllama') return null;
    if (!this.isLoaded(modelId)) return null;

    return {
      generate: async (input: WllamaGenerateInput, opts: GenerateOptions, onChunk: (text: string) => void, reason?: LocalModelBusyReason, signal?: AbortSignal): Promise<string> => {
        if (signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
        if (this.isBusy(modelId)) {
          throw new Error(`Model ${modelId} is busy`);
        }
        this.setStatus(modelId, 'busy', reason ?? 'chat');
        entry.onChunk = onChunk;
        entry.abortRequested = false;
        const epoch = ++entry.epoch;
        const onAbort = () => {
          if (this.engines.get(modelId) === entry && entry.epoch === epoch) this.abort(modelId);
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
          const result = await this.sendRequest(modelId, {
            type: 'generate',
            epoch,
            messages: input.messages,
            assistantPrefix: input.assistantPrefix,
            ...localGenerationOptions(opts),
          }) as { fullText: string; tokensGenerated: number };

          return result.fullText;
        } finally {
          signal?.removeEventListener('abort', onAbort);
          entry.onChunk = null;
          if (entry.status === 'busy') {
            this.setStatus(modelId, 'ready');
          }
        }
      },
      abort: () => this.abort(modelId),
    };
  }

  getTransformersEngine(modelId: string): TransformersWorkerProxy | null {
    const entry = this.engines.get(modelId);
    if (!entry || entry.engine !== 'transformers.js') return null;
    if (!this.isLoaded(modelId)) return null;

    return {
      classify: async (text: string, reason?: LocalModelBusyReason, signal?: AbortSignal): Promise<ClassificationLabel[]> => {
        if (signal?.aborted) throw new DOMException('Classification aborted', 'AbortError');
        if (this.isBusy(modelId)) {
          throw new Error(`Model ${modelId} is busy`);
        }
        this.setStatus(modelId, 'busy', reason ?? 'moderation');
        const epoch = ++entry.epoch;
        const onAbort = () => {
          if (this.engines.get(modelId) === entry && entry.epoch === epoch) this.abort(modelId);
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
          const result = await this.sendRequest(modelId, {
            type: 'classify',
            text,
            epoch,
          }) as { labels: ClassificationLabel[] };

          return result.labels;
        } finally {
          signal?.removeEventListener('abort', onAbort);
          if (entry.status === 'busy') {
            this.setStatus(modelId, 'ready');
          }
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Change listeners (for React integration)
  // -------------------------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeLogs(listener: (event: RuntimeLogEvent) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  subscribeDiagnostics(listener: (event: RuntimeDiagnosticEvent) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  subscribeLoadProgress(listener: (event: RuntimeLoadProgressEvent) => void): () => void {
    this.loadProgressListeners.add(listener);
    return () => this.loadProgressListeners.delete(listener);
  }

  /** Snapshot of all model statuses for useSyncExternalStore */
  getSnapshot(): ReadonlyMap<string, LocalModelStatus> {
    const snapshot = new Map<string, LocalModelStatus>();
    for (const [id, entry] of this.engines) {
      snapshot.set(id, entry.status);
    }
    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Persist discovered context length to the Zustand store so that
   * modelLookup can access it before the model is loaded next time.
   */
  private persistContextLength(
    modelId: string,
    contextLength?: number,
    nativeContextLength?: number,
  ): void {
    if (!_storeGetter || (!contextLength && !nativeContextLength)) return;
    const state = _storeGetter();
    const def = state.localModels.find((m) => m.id === modelId);
    if (!def) return;

    const existingMeta = def.displayMeta;
    const newContextLength = nativeContextLength ?? contextLength;
    // Only update if the value actually changed
    if (existingMeta?.contextLength === newContextLength) return;

    state.updateLocalModel(modelId, {
      displayMeta: {
        ...existingMeta,
        supportsTextInference: existingMeta?.supportsTextInference ?? true,
        contextLength: newContextLength,
      },
    });
  }

  /**
   * Look up expected context length from the store or catalog so the worker
   * can allocate the right n_ctx instead of a fixed default.
   */
  private lookupExpectedContextLength(modelId: string): number | undefined {
    // Check store first (persisted from a previous load)
    if (_storeGetter) {
      const def = _storeGetter().localModels.find((m) => m.id === modelId);
      if (def?.displayMeta?.contextLength) return def.displayMeta.contextLength;
    }
    // Fallback to curated catalog
    const cat = CURATED_MODELS.find((c) => c.id === modelId);
    return cat?.displayMeta?.contextLength ?? undefined;
  }

  private createWorker(engine: LocalModelEngine): Worker {
    if (engine === 'wllama') {
      return new Worker(
        new URL('../workers/wllamaWorker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    return new Worker(
      new URL('../workers/transformersWorker.ts', import.meta.url),
      { type: 'module' },
    );
  }

  private setStatus(modelId: string, status: LocalModelStatus, busyReason?: LocalModelBusyReason): void {
    const entry = this.engines.get(modelId);
    if (entry) {
      entry.status = status;
      entry.busyReason = status === 'busy' ? busyReason : undefined;
      debugReport(`local-model:${modelId}`, {
        label: 'Local model',
        status: status === 'error' ? 'error' : status === 'loading' || status === 'busy' ? 'active' : 'done',
        detail: `${modelId} ${status}${busyReason ? ` (${busyReason})` : ''}`,
      });
      emitRuntimeDebugLog(modelId, status === 'error' ? 'error' : 'debug', `status=${status}${busyReason ? ` busyReason=${busyReason}` : ''}`);
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private emitLog(event: RuntimeLogEvent): void {
    emitRuntimeDebugLog(event.modelId, event.level, event.text, event.timestamp);
    for (const listener of this.logListeners) {
      listener(event);
    }
  }

  private emitDiagnostic(event: RuntimeDiagnosticEvent): void {
    emitRuntimeDebugLog(event.modelId, 'debug', `diagnostic ${event.phase}: ${formatDebugValue(event.payload)}`, event.timestamp);
    for (const listener of this.diagnosticListeners) {
      listener(event);
    }
  }

  private emitLoadProgress(event: RuntimeLoadProgressEvent): void {
    debugReport(`local-load:${event.modelId}`, {
      label: 'Local model load',
      status: event.phase === 'error' ? 'error' : event.phase === 'complete' ? 'done' : 'active',
      detail: `${event.phase} ${Math.max(0, Math.round(event.percent))}% ${event.detail}`,
    });
    emitRuntimeDebugLog(event.modelId, event.phase === 'error' ? 'error' : 'debug', `load-progress ${event.phase} ${event.percent}% ${event.detail}`, event.timestamp);
    for (const listener of this.loadProgressListeners) {
      listener(event);
    }
  }

  private sendRequest(modelId: string, payload: Record<string, unknown>): Promise<unknown> {
    const entry = this.engines.get(modelId);
    if (!entry) return Promise.reject(new Error(`No engine for model ${modelId}`));

    const id = entry.nextId++;
    if (payload.type === 'generate' || payload.type === 'classify') {
      entry.activeRequestId = id;
      entry.activeRequestEpoch = payload.epoch as number;
    }
    emitRuntimeDebugLog(modelId, 'debug', `request #${id} ${String(payload.type ?? 'unknown')}: ${summarizePayload(payload)}`);
    return new Promise((resolve, reject) => {
      entry.pending.set(id, { resolve, reject });
      entry.worker.postMessage({ ...payload, id });
    });
  }

  private handleWorkerMessage(modelId: string, data: Record<string, unknown>): void {
    const entry = this.engines.get(modelId);
    if (!entry) return;

    const id = data.id as number;
    const type = data.type as string;

    // Worker log forwarding (worker console is not visible in preview tools)
    if (type === '__log') {
      const level = data.level as string;
      const text = data.text as string;
      if (level === 'error') console.error(text);
      else console.info(text);
      if (level !== 'info' || shouldLogWorkerInfo(text)) {
        this.emitLog({
          modelId,
          level,
          text,
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (type === '__diagnostic') {
      const phase = String(data.phase ?? 'unknown');
      const payload = (data.payload as Record<string, unknown> | undefined) ?? {};
      // Capture WASM capabilities from worker-init diagnostic
      if (phase === 'worker-init') {
        this.wasmCaps.set(modelId, {
          webgpu: !!payload.webgpuWasmSelected,
          memory64: !!payload.memory64Selected,
          multiThread: !!payload.multiThreadCapable,
        });
        this.notifyListeners();
      }
      this.emitDiagnostic({
        modelId,
        phase,
        timestamp: Date.now(),
        payload,
      });
      return;
    }

    if (type === '__load_progress') {
      this.emitLoadProgress({
        modelId,
        phase: String(data.phase ?? 'unknown'),
        percent: (data.percent as number) ?? 0,
        detail: String(data.detail ?? ''),
        timestamp: Date.now(),
      });
      return;
    }

    // Streaming chunks don't resolve the pending promise
    if (type === 'chunk') {
      if (id === entry.activeRequestId && entry.activeRequestEpoch === entry.epoch) {
        entry.onChunk?.(data.text as string);
      }
      return;
    }

    // Error response
    if (type === 'error') {
      const pending = entry.pending.get(id);
      if (pending) {
        entry.pending.delete(id);
        emitRuntimeDebugLog(modelId, 'error', `response #${id} error: ${String(data.message ?? '')}`);
        pending.reject(new Error(data.message as string));
      }
      if (id === entry.activeRequestId) {
        entry.activeRequestId = null;
        entry.activeRequestEpoch = null;
      }
      return;
    }

    // Success response
    const pending = entry.pending.get(id);
    if (pending) {
      entry.pending.delete(id);
      emitRuntimeDebugLog(modelId, 'debug', `response #${id} ${type}: ${summarizePayload(data)}`);
      pending.resolve(data);
    }
    if (id === entry.activeRequestId) {
      entry.activeRequestId = null;
      entry.activeRequestEpoch = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Model definition lookup (used by ensureLoaded)
// ---------------------------------------------------------------------------

/**
 * Find a model definition by ID.
 * Checks the Zustand store first, then falls back to the curated catalog.
 *
 * Uses lazy import of store to avoid circular dependency.
 */
let _storeGetter: (() => {
  localModels: LocalModelDefinition[];
  updateLocalModel: (id: string, patch: Partial<LocalModelDefinition>) => void;
}) | null = null;

/** Called once by the app to wire up the store for findModelDefinition. */
export function setRuntimeStoreGetter(getter: () => {
  localModels: LocalModelDefinition[];
  updateLocalModel: (id: string, patch: Partial<LocalModelDefinition>) => void;
}): void {
  _storeGetter = getter;
}

export function findModelDefinition(modelId: string): LocalModelDefinition | null {
  if (_storeGetter) {
    const def = _storeGetter().localModels.find((m) => m.id === modelId);
    if (def) return def;
  }

  // Fallback: check curated catalog
  const cat = CURATED_MODELS.find((c) => c.id === modelId);
  if (cat) {
    return {
      id: cat.id,
      engine: cat.engine,
      tasks: cat.tasks,
      label: cat.label,
      origin: cat.huggingFaceRepo,
      source: 'opfs',
      manifest: cat.manifest,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const localModelRuntime = new LocalModelRuntime();
