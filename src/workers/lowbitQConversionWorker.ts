/**
 * Web Worker for lowbit-Q GGUF conversion.
 *
 * Routes to the v2 mixed-bit pipeline (convertToLowbitQV2Streaming) by default.
 * Falls back to the legacy v1 pipeline (convertToLowbitQStreaming) only when
 * explicitly requested via the deprecated `convertMode` field.
 *
 * Message protocol:
 *   Main → Worker: ConversionStartRequest
 *   Worker → Main: { id, type: 'progress', progress: ConversionProgress }
 *   Worker → Main: { id, type: 'done', result: Blob, originalSize, convertedSize, tensorRecords? }
 *   Worker → Main: { id, type: 'error', message: string }
 */

import {
  convertToLowbitQStreaming,
  convertToLowbitQV2Streaming,
  convertToLowbitQV2StreamingToOPFS,
} from '../local-llm/lowbit-q/convert';
import { createTensorFilter, type LowbitQConvertMode } from '../local-llm/lowbit-q/tensorFilter';
import { DEFAULT_ALLOCATOR_CONFIG } from '../local-llm/lowbit-q/allocator';
import type {
  ConversionStartRequest,
  ConversionProgressMessage,
  ConversionDoneMessage,
  ConversionErrorMessage,
} from '../local-llm/lowbit-q/types';

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleStart(req: ConversionStartRequest) {
  try {
    const file = req.sourceFile;

    // Validate source file
    if (!file || file.size === 0) {
      respondError(req.id, '変換元のファイルが空または無効です。');
      return;
    }

    // Validate GGUF magic (read only first 4 bytes)
    const magicSlice = await file.slice(0, 4).arrayBuffer();
    const magic = new Uint8Array(magicSlice);
    if (magic[0] !== 0x47 || magic[1] !== 0x47 || magic[2] !== 0x55 || magic[3] !== 0x46) {
      respondError(req.id,
        'GGUFファイルの検証に失敗しました: マジックバイトが不正です。' +
        'GGUF形式のファイルを指定してください。');
      return;
    }

    const onProgress = (progress: Parameters<typeof respondProgress>[1]) => {
      respondProgress(req.id, progress);
    };

    // ---------------------------------------------------------------------------
    // v2 path (default): mixed-bit allocator pipeline
    // ---------------------------------------------------------------------------
    // Use legacy v1 only when the deprecated `convertMode` field is explicitly set
    // and no allocatorConfig is provided. This preserves backward compatibility
    // for callers that have not yet migrated to the v2 API.
    const useLegacyV1 = req.convertMode !== undefined && req.allocatorConfig === undefined;

    let result:
      | { data: Uint8Array; originalSize: number; convertedSize: number; tensorRecords: unknown[] }
      | { originalSize: number; convertedSize: number; tensorRecords: unknown[] };

    if (useLegacyV1) {
      // Legacy v1: uniform SVID_1BIT conversion controlled by convertMode filter
      const convertMode = (req.convertMode ?? 'all') as LowbitQConvertMode;
      const tensorFilter = createTensorFilter(convertMode);
      result = await convertToLowbitQStreaming(file, {
        onProgress,
        computeQuality: req.computeQuality ?? false,
        tensorFilter,
      });
    } else {
      // v2: mixed-bit allocation pipeline (default for all new callers)
      const allocatorConfig = req.allocatorConfig ?? DEFAULT_ALLOCATOR_CONFIG;
      result = req.opfsTarget
        ? await convertToLowbitQV2StreamingToOPFS(file, req.opfsTarget, {
            onProgress,
            computeQuality: req.computeQuality ?? false,
            allocatorConfig,
            totalLayers: req.totalLayers,
            sourceModelName: req.sourceModelName,
          })
        : await convertToLowbitQV2Streaming(file, {
            onProgress,
            computeQuality: req.computeQuality ?? false,
            allocatorConfig,
            totalLayers: req.totalLayers,
            sourceModelName: req.sourceModelName,
          });
    }

    const msg: ConversionDoneMessage = {
      id: req.id,
      type: 'done',
      originalSize: result.originalSize,
      convertedSize: result.convertedSize,
      tensorRecords: result.tensorRecords as ConversionDoneMessage['tensorRecords'],
      persistedToOpfs: req.opfsTarget !== undefined,
    };
    if ('data' in result) {
      msg.result = new Blob([result.data], { type: 'application/octet-stream' });
    }
    self.postMessage(msg);
  } catch (e) {
    const err = e as Error;
    respondError(req.id, `Lowbit-Q変換に失敗しました: ${err.message}`);
  }
}

function respondProgress(id: number, progress: ConversionProgressMessage['progress']) {
  const msg: ConversionProgressMessage = { id, type: 'progress', progress };
  self.postMessage(msg);
}

function respondError(id: number, message: string) {
  const msg: ConversionErrorMessage = { id, type: 'error', message };
  self.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

self.onmessage = async (ev: MessageEvent<ConversionStartRequest>) => {
  const req = ev.data;

  switch (req.type) {
    case 'start':
      await handleStart(req);
      break;
    default:
      respondError(
        (req as { id: number }).id,
        `Unknown message type: ${(req as { type: string }).type}`,
      );
  }
};
