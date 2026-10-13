/**
 * Local evaluation API — browser-side moderation and quality hints.
 *
 * Uses Transformers.js classification for moderation screening
 * and wllama generation for quality hints.
 */

import { localModelRuntime, promptAsInput, type LocalModelOwnerId } from '@src/local-llm/runtime';
import type { LocalModerationResult, StandardQualityEvaluationResult, QualityScores, AxisProgressState } from '@type/evaluation';
import { localModeration, localAxisPrompt, localQualityResult } from '@utils/localEvaluationCore';
import { qualityAxisKeys } from '@type/evaluation';
import type { LocalModelTask } from '@src/local-llm/types';
import useStore from '@store/store';
import i18next from 'i18next';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getActiveModelId(task: LocalModelTask): string | null {
  const state = useStore.getState();
  if (!state.localModelEnabled) return null;
  return state.activeLocalModels[task] ?? null;
}

// ---------------------------------------------------------------------------
// Local moderation (Transformers.js classification)
// ---------------------------------------------------------------------------

/**
 * Run local moderation screening using a Transformers.js classifier.
 *
 * Returns a 3-level screening result (safe / warn / block-candidate)
 * that is NOT a replacement for remote 13-category moderation.
 */
export async function runLocalModeration(
  text: string,
  ownerId?: LocalModelOwnerId,
  signal?: AbortSignal,
  modelId = getActiveModelId('analysis') ?? getActiveModelId('moderation'),
): Promise<LocalModerationResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!modelId) {
    throw new Error('No local analysis/moderation model configured');
  }

  // Safety net: ensure the model is loaded before attempting to use it
  await localModelRuntime.ensureLoaded(modelId, ownerId);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const engine = localModelRuntime.getTransformersEngine(modelId);
  if (!engine) {
    throw new Error('Local moderation model not loaded');
  }

  const labels = await engine.classify(text, 'moderation', signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  return localModeration(labels, Date.now());
}

/**
 * Run local quality evaluation using the wllama model.
 *
 * Evaluates each of the 5 quality axes with a separate prompt to get
 * per-axis reasoning from small models that cannot handle all axes at once.
 * Results are marked with source='local'.
 */
export async function runLocalQualityEvaluation(
  text: string,
  assistantResponse: string | undefined,
  onAxisProgress?: (axis: keyof QualityScores, state: AxisProgressState) => void,
  ownerId?: LocalModelOwnerId,
  signal?: AbortSignal,
  modelId = getActiveModelId('analysis') ?? getActiveModelId('quality') ?? getActiveModelId('generation'),
): Promise<StandardQualityEvaluationResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!modelId) {
    throw new Error('No local analysis/generation model configured');
  }

  await localModelRuntime.ensureLoaded(modelId, ownerId);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const engine = localModelRuntime.getWllamaEngine(modelId);
  if (!engine) {
    throw new Error('Local quality model not loaded');
  }

  const outputs: Partial<Record<keyof QualityScores, string>> = {};

  // Set all axes to 'waiting' initially
  for (const axis of qualityAxisKeys) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onAxisProgress?.(axis, 'waiting');
  }

  // Evaluate each axis individually
  for (const axis of qualityAxisKeys) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onAxisProgress?.(axis, 'generating');
    const request = localAxisPrompt(axis, text, assistantResponse, i18next.language);

    console.info(`[evaluation] local quality: evaluating axis "${axis}"...`);

    let raw = await engine.generate(
      promptAsInput(request.prompt),
      request.options,
      () => {},
      'evaluation',
      signal,
    );
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    console.info(`[evaluation] local quality axis "${axis}" output length:`, raw.length, 'preview:', raw.slice(0, 100));

    // If empty, try once more with a simpler prompt
    if (!raw.trim()) {
      raw = await engine.generate(promptAsInput(request.fallback), request.fallbackOptions, () => {}, 'evaluation', signal);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }

    outputs[axis] = raw;
    onAxisProgress?.(axis, 'done');
  }

  const result = localQualityResult(outputs, Date.now());
  console.info('[evaluation] local quality per-axis scores:', result.scores);
  return result;
}
