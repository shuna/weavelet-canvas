import { v4 as uuidv4 } from 'uuid';
import { localModelRuntime } from '@src/local-llm/runtime';
import { beginAiTask, cancelAiTask, finishAiTask, isAiTaskCurrent, ownsAiTask, evaluationDependencyIds, type AiTaskTicket } from './aiTaskLifetime';
import { showToast } from '@utils/showToast';
/**
 * Hook for running evaluations on chat messages.
 * Integrates with the submit flow for auto-evaluation and
 * exposes manual trigger functions.
 */

import { useCallback } from 'react';
import useStore from '@store/store';
import { runSafetyCheck, runQualityEvaluation } from '@api/evaluation';
import { runLocalModeration, runLocalQualityEvaluation } from '@api/localEvaluation';
import {
  createLocalModelOwner,
  prepareModelsForExecution,
  releaseModelsForExecution,
} from '@src/local-llm/orchestrator';
import { evaluationResultKey, qualityAxisKeys } from '@type/evaluation';
import type { EvaluationResult, QualityScores, AxisProgressState } from '@type/evaluation';
import type { ContentInterface } from '@type/chat';
import type { ResolvedProvider } from './submitHelpers';
import i18next from 'i18next';

function extractText(content: ContentInterface[]): string {
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

export interface EvaluationContext {
  providerId?: import('@type/provider').ProviderId;
  chatId: string;
  nodeId: string;
  parentTicket?: AiTaskTicket;
  endpoint: string;
  apiKey?: string;
  model: string;
  openRouter?: import('@type/chat').OpenRouterChatSettings;
}

function evaluationTask(chatId: string, nodeId: string, phase: 'pre-send' | 'post-receive', parent?: AiTaskTicket) {
  const key = evaluationResultKey(chatId, nodeId, phase);
  const controller = new AbortController();
  const ticket = beginAiTask({ requestId: uuidv4(), chatId, nodeId, parent,
    kind: phase === 'pre-send' ? 'evaluation-pre' : 'evaluation-post',
    dependencyIds: evaluationDependencyIds(chatId, nodeId, phase),
    cancel: () => {
      controller.abort();
      useStore.getState().setEvaluationPending(key, false);
      useStore.getState().clearEvaluationAxisProgress(key);
    },
  });
  return Object.assign(ticket, { controller });
}

async function runEvaluationForPhase(
  phase: 'pre-send' | 'post-receive',
  userText: string,
  assistantText: string | undefined,
  ctx: EvaluationContext
): Promise<void> {
  const store = useStore.getState();
  const settings = store.evaluationSettings;
  const analysisModelId = store.localModelEnabled ? (store.activeLocalModels.analysis ?? null) : null;
  const moderationModelId = store.localModelEnabled
    ? (analysisModelId ?? store.activeLocalModels.moderation ?? null) : null;
  const key = evaluationResultKey(ctx.chatId, ctx.nodeId, phase);

  const shouldSafety =
    (phase === 'pre-send' && settings.safetyPreSend === 'auto') ||
    (phase === 'post-receive' && settings.safetyPostReceive === 'auto');

  const shouldQuality =
    (phase === 'pre-send' && settings.qualityPreSend === 'auto') ||
    (phase === 'post-receive' && settings.qualityPostReceive === 'auto');

  if (!shouldSafety && !shouldQuality) return;

  const ticket = evaluationTask(ctx.chatId, ctx.nodeId, phase, ctx.parentTicket);
  store.setEvaluationPending(key, true);

  const result: EvaluationResult = { phase };
  let localModelOwnerId: string | undefined;
  let unregisterOwner: (() => void) | undefined;

  try {
    const textToCheck = phase === 'pre-send' ? userText : (assistantText ?? '');
    const { safetyEngine, hybridRemoteOnSafe } = settings;

    // Prepare local evaluation models before first use
    if (store.localModelEnabled && ctx.providerId !== 'lan') {
      const evalIds: string[] = [];
      if (analysisModelId) evalIds.push(analysisModelId);
      if (shouldSafety && !analysisModelId && moderationModelId) evalIds.push(moderationModelId);
      if (evalIds.length > 0) {
        localModelOwnerId = createLocalModelOwner(`evaluation:${key}:${phase}`);
        unregisterOwner = localModelRuntime.registerOwnerCancellation(localModelOwnerId, () => cancelAiTask(ticket));
        await prepareModelsForExecution(localModelOwnerId, evalIds, { signal: ticket.controller.signal });
      }
    }

    if (!isAiTaskCurrent(ticket)) return;
    if (shouldSafety && textToCheck) {
      // --- Local safety (if engine is local or hybrid) ---
      if (safetyEngine === 'local' || safetyEngine === 'hybrid') {
        try {
          result.localSafety = ctx.providerId === 'lan'
            ? await runLanLocalSafety(textToCheck, ticket.controller.signal)
            : await runLocalModeration(textToCheck, localModelOwnerId, ticket.controller.signal, moderationModelId);
        } catch (e) {
          console.warn('[evaluation] local safety screening failed:', e);
        }
      }

      if (!isAiTaskCurrent(ticket)) return;
      // --- Remote safety ---
      // In 'local' mode, if local failed, fall back to remote as a safety net
      const localOnlyButFailed = safetyEngine === 'local' && !result.localSafety;
      const shouldRunRemote =
        safetyEngine === 'remote' ||
        localOnlyButFailed ||
        (safetyEngine === 'hybrid' && (
          // Always run remote if local found issues
          result.localSafety?.screening === 'warn' ||
          result.localSafety?.screening === 'block-candidate' ||
          // Also run remote if hybridRemoteOnSafe is true (default)
          hybridRemoteOnSafe ||
          // Also run remote if local failed (no result)
          !result.localSafety
        ));

      if (shouldRunRemote && ctx.providerId !== 'lan') {
        try {
          result.safety = await runSafetyCheck(textToCheck, ctx.openRouter, ticket.controller.signal);
        } catch (e) {
          console.warn('[evaluation] remote safety check failed:', e);
          showToast(e instanceof Error ? e.message : String(e), 'error');
        }
      }
    }

    if (ctx.providerId === 'lan' && shouldSafety && !result.localSafety) showToast('Safety evaluation is unavailable: LAN conversations do not use remote moderation', 'error');
    if (!isAiTaskCurrent(ticket)) return;
    if (shouldQuality && userText) {
      if (analysisModelId && ctx.providerId !== 'lan') {
        // Use local quality evaluation as the primary evaluator
        if (userText) {
          try {
            const axisProgress = (axis: keyof QualityScores, state: AxisProgressState) => {
              if (isAiTaskCurrent(ticket)) useStore.getState().setEvaluationAxisProgress(key, { [axis]: state });
            };
            result.quality = await runLocalQualityEvaluation(
              userText,
              phase === 'post-receive' ? assistantText : undefined,
              axisProgress,
              localModelOwnerId,
              ticket.controller.signal,
              analysisModelId,
            );
          } catch (e) {
            console.warn('[evaluation] local quality evaluation failed:', e);
          }
        }
      } else {
        // Use remote API for quality evaluation
        try {
          result.quality = await runQualityEvaluation(
            userText,
            phase === 'post-receive' ? assistantText : undefined,
            ctx.endpoint,
            ctx.model,
            ctx.apiKey,
            i18next.language,
            undefined,
            ctx.openRouter,
            ticket.controller.signal,
            ctx.providerId
          );
        } catch (e) {
          console.warn('[evaluation] quality evaluation failed:', e);
          showToast(e instanceof Error ? e.message : String(e), 'error');
        }
      }
    }

    if (isAiTaskCurrent(ticket) && (result.safety || result.quality || result.localSafety)) {
      useStore.getState().setEvaluationResult(key, result);
    }
  } finally {
    unregisterOwner?.();
    if (localModelOwnerId) releaseModelsForExecution(localModelOwnerId);
    if (ownsAiTask(ticket)) {
      useStore.getState().setEvaluationPending(key, false);
      useStore.getState().clearEvaluationAxisProgress(key);
    }
    finishAiTask(ticket);
  }
}

/**
 * Run auto-evaluations for pre-send phase.
 * Called before the prompt is sent to the API.
 */
export async function runPreSendEvaluation(
  userContent: ContentInterface[],
  ctx: EvaluationContext
): Promise<void> {
  const userText = extractText(userContent);
  if (!userText) return;
  await runEvaluationForPhase('pre-send', userText, undefined, ctx);
}

/**
 * Run auto-evaluations for post-receive phase.
 * Called after the response is fully received.
 */
export async function runPostReceiveEvaluation(
  userContent: ContentInterface[],
  assistantContent: ContentInterface[],
  ctx: EvaluationContext
): Promise<void> {
  const userText = extractText(userContent);
  const assistantText = extractText(assistantContent);
  if (!userText) return;
  await runEvaluationForPhase('post-receive', userText, assistantText, ctx);
}

export async function runLanLocalSafety(text: string, signal?: AbortSignal) {
  const state = useStore.getState();
  const engine = state.evaluationSettings.safetyEngine;
  const modelId = state.localModelEnabled ? state.activeLocalModels.analysis ?? state.activeLocalModels.moderation : undefined;
  if ((engine !== 'local' && engine !== 'hybrid') || !modelId) throw new Error('LAN safety evaluation requires an available local classifier');
  const owner = createLocalModelOwner('lan-safety');
  try {
    await prepareModelsForExecution(owner, [modelId], { signal });
    return await runLocalModeration(text, owner, signal, modelId);
  } finally { releaseModelsForExecution(owner); }
}

/**
 * Hook providing manual evaluation trigger functions.
 */
export function useEvaluation() {
  const triggerManualSafety = useCallback(
    async (
      text: string,
      chatId: string,
      nodeId: string,
      phase: 'pre-send' | 'post-receive',
      resolvedProvider: ResolvedProvider
    ) => {
      const store = useStore.getState();
      const key = evaluationResultKey(chatId, nodeId, phase);
      const ticket = evaluationTask(chatId, nodeId, phase);
      store.setEvaluationPending(key, true);
      try {
        if (resolvedProvider.providerId === 'lan' || store.chats?.find(c => c.id === chatId)?.config.providerId === 'lan') {
          const localSafety = await runLanLocalSafety(text, ticket.controller.signal);
          if (isAiTaskCurrent(ticket)) useStore.getState().setEvaluationResult(key, { ...useStore.getState().evaluationResults[key], phase, localSafety });
          return;
        }
        const safety = await runSafetyCheck(text, store.chats?.find(c => c.id === chatId)?.config.openRouter, ticket.controller.signal);
        if (!isAiTaskCurrent(ticket)) return;
        const existing = useStore.getState().evaluationResults[key];
        useStore.getState().setEvaluationResult(key, {
          ...existing,
          phase,
          safety,
        });
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        if (ownsAiTask(ticket)) useStore.getState().setEvaluationPending(key, false);
        finishAiTask(ticket);
      }
    },
    []
  );

  const triggerManualQuality = useCallback(
    async (
      userText: string,
      assistantText: string | undefined,
      chatId: string,
      nodeId: string,
      phase: 'pre-send' | 'post-receive',
      resolvedProvider: ResolvedProvider,
      model: string
    ) => {
      const store = useStore.getState();
      const key = evaluationResultKey(chatId, nodeId, phase);
      const ticket = evaluationTask(chatId, nodeId, phase);
      store.setEvaluationPending(key, true);
      let localModelOwnerId: string | undefined;
      let unregisterOwner: (() => void) | undefined;
      try {
        const analysisModelId = store.localModelEnabled
          ? (store.activeLocalModels['analysis'] ?? null)
          : null;

        if (analysisModelId && resolvedProvider.providerId !== 'lan') {
          // Use local quality evaluation
          if (store.localModelEnabled) {
            localModelOwnerId = createLocalModelOwner(`manual-evaluation:${key}`);
            unregisterOwner = localModelRuntime.registerOwnerCancellation(localModelOwnerId, () => cancelAiTask(ticket));
            await prepareModelsForExecution(localModelOwnerId, [analysisModelId], { signal: ticket.controller.signal });
          }
          const axisProgress = (axis: keyof QualityScores, state: AxisProgressState) => {
            if (isAiTaskCurrent(ticket)) useStore.getState().setEvaluationAxisProgress(key, { [axis]: state });
          };
          const quality = await runLocalQualityEvaluation(userText, assistantText, axisProgress, localModelOwnerId, ticket.controller.signal, analysisModelId);
          if (!isAiTaskCurrent(ticket)) return;
          const existing = useStore.getState().evaluationResults[key];
          useStore.getState().setEvaluationResult(key, {
            ...existing,
            phase,
            quality,
          });
        } else {
          // Use remote API
          const quality = await runQualityEvaluation(
            userText,
            assistantText,
            resolvedProvider.endpoint,
            model,
            resolvedProvider.key,
            i18next.language,
            undefined,
            store.chats?.find(c => c.id === chatId)?.config.openRouter,
            ticket.controller.signal,
            resolvedProvider.providerId
          );
          if (!isAiTaskCurrent(ticket)) return;
          const existing = useStore.getState().evaluationResults[key];
          useStore.getState().setEvaluationResult(key, {
            ...existing,
            phase,
            quality,
          });
        }
      } catch (e) {
        console.warn('[evaluation] manual quality evaluation failed:', e);
      } finally {
        unregisterOwner?.();
        if (localModelOwnerId) releaseModelsForExecution(localModelOwnerId);
        if (ownsAiTask(ticket)) useStore.getState().setEvaluationPending(key, false);
        if (ownsAiTask(ticket)) useStore.getState().clearEvaluationAxisProgress(key);
        finishAiTask(ticket);
      }
    },
    []
  );

  return { triggerManualSafety, triggerManualQuality };
}
