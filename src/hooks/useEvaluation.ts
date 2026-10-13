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
import { localSafetyPolicy, localModerationModelID } from '@utils/localEvaluationCore';
import { autoEvaluationPlan } from '@utils/evaluationAutoCore';
import { applyAutoEvaluationResult } from '@utils/evaluationState';
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

export interface EvaluationContext {
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
  const ticket = beginAiTask({ requestId: crypto.randomUUID(), chatId, nodeId, parent,
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
  userContent: ContentInterface[],
  assistantContent: ContentInterface[] | undefined,
  ctx: EvaluationContext
): Promise<void> {
  const store = useStore.getState();
  const settings = store.evaluationSettings;
  const { userText, assistantText, safetyText, shouldSafety, shouldQuality } = autoEvaluationPlan({phase, userContent, assistantContent, settings});
  const analysisModelId = store.localModelEnabled ? (store.activeLocalModels.analysis ?? null) : null;
  const moderationModelId = localModerationModelID(store.localModelEnabled, store.activeLocalModels);
  const key = evaluationResultKey(ctx.chatId, ctx.nodeId, phase);

  if (!shouldSafety && !shouldQuality) return;

  const ticket = evaluationTask(ctx.chatId, ctx.nodeId, phase, ctx.parentTicket);
  store.setEvaluationPending(key, true);

  const result: EvaluationResult = { phase };
  let localModelOwnerId: string | undefined;
  let unregisterOwner: (() => void) | undefined;
  let localModelsPrepared = true;

  try {
    const { safetyEngine, hybridRemoteOnSafe } = settings;

    // Prepare local evaluation models before first use
    if (store.localModelEnabled) {
      const evalIds: string[] = [];
      if (analysisModelId) evalIds.push(analysisModelId);
      if (shouldSafety && !analysisModelId && moderationModelId) evalIds.push(moderationModelId);
      if (evalIds.length > 0) {
        localModelOwnerId = createLocalModelOwner(`evaluation:${key}:${phase}`);
        unregisterOwner = localModelRuntime.registerOwnerCancellation(localModelOwnerId, () => cancelAiTask(ticket));
        try {
          await prepareModelsForExecution(localModelOwnerId, evalIds, { signal: ticket.controller.signal });
        } catch (e) {
          localModelsPrepared = false;
          console.warn('[evaluation] local model preparation failed:', e);
        }
      }
    }

    if (!isAiTaskCurrent(ticket) || ticket.controller.signal.aborted) return;
    if (shouldSafety && safetyText) {
      // --- Local safety (if engine is local or hybrid) ---
      if (localModelsPrepared && localSafetyPolicy(safetyEngine, hybridRemoteOnSafe).runLocal) {
        try {
          result.localSafety = await runLocalModeration(safetyText, localModelOwnerId, ticket.controller.signal, moderationModelId);
        } catch (e) {
          console.warn('[evaluation] local safety screening failed:', e);
        }
      }

      if (!isAiTaskCurrent(ticket) || ticket.controller.signal.aborted) return;
      // --- Remote safety ---
      const shouldRunRemote = localSafetyPolicy(safetyEngine, hybridRemoteOnSafe, result.localSafety).runRemote;

      if (shouldRunRemote) {
        try {
          result.safety = await runSafetyCheck(safetyText, ctx.openRouter, ticket.controller.signal);
        } catch (e) {
          console.warn('[evaluation] remote safety check failed:', e);
          showToast(e instanceof Error ? e.message : String(e), 'error');
        }
      }
    }

    if (!isAiTaskCurrent(ticket) || ticket.controller.signal.aborted) return;
    if (shouldQuality && userText) {
      if (analysisModelId) {
        // Use local quality evaluation as the primary evaluator
        if (localModelsPrepared && userText) {
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
            ticket.controller.signal
          );
        } catch (e) {
          console.warn('[evaluation] quality evaluation failed:', e);
          showToast(e instanceof Error ? e.message : String(e), 'error');
        }
      }
    }

    if (isAiTaskCurrent(ticket) && !ticket.controller.signal.aborted && (result.safety || result.quality || result.localSafety)) {
      const current = useStore.getState();
      current.setEvaluationResult(key, applyAutoEvaluationResult(current.evaluationResults[key], result));
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
  await runEvaluationForPhase('pre-send', userContent, undefined, ctx);
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
  await runEvaluationForPhase('post-receive', userContent, assistantContent, ctx);
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
        const safety = await runSafetyCheck(text, store.chats?.find(c => c.id === chatId)?.config.openRouter, ticket.controller.signal);
        if (!isAiTaskCurrent(ticket)) return;
        const existing = useStore.getState().evaluationResults[key];
        useStore.getState().setEvaluationResult(key, {
          ...existing,
          phase,
          safety,
        });
      } catch (e) {
        console.warn('[evaluation] manual safety check failed:', e);
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

        if (analysisModelId) {
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
            ticket.controller.signal
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
