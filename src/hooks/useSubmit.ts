import { v4 as uuidv4 } from 'uuid';
import { localModelRuntime } from '@src/local-llm/runtime';
import { beginAiTask, finishAiTask, isAiTaskCurrent } from './aiTaskLifetime';
import i18next from 'i18next';
import { hardOpenRouterConstraints } from '@utils/openrouterControls';
import { normalizeConfigStream } from '@utils/streamSupport';
import { useWorkspaceStore, useWorkspaceReadOnly } from '@store/workspaceScope';
import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { countTokens, limitMessageTokens, loadEncoder } from '@utils/messageUtils';
import { hasMeaningfulMessageContent } from '@utils/contentValidation';
import { getModelOutputLimit, getModelContextInfo } from '@utils/modelLookup';
import { confirmChatModelFavorite, resolveChatModel } from '@utils/chatModelResolution';
import { fitsContextWindow, getMaxCompletionTokensForContext, getPromptBudgetForContext } from '@utils/tokenBudget';
import {
  applySubmitTokenUsage,
  buildGeneratingSession,
  getSubmitContextMessages,
  insertAssistantPlaceholder,
  maybeGenerateAutoTitle,
  resolveProviderForModel,
  sanitizeMessagesForSubmit,
  SubmitMode,
  type ResolvedProvider,
} from './submitHelpers';
import {
  clearSubmitSessionRuntime,
  createSubmitAbortController,
  executeSubmitStream,
  executeLocalSubmit,
  getGenerationIdFromSubmitError,
  isChatGenerating,
  stopSubmitSession,
  stopSubmitSessionsForChat,
} from './submitRuntime';
import { isLocalModelConfig } from './submitHelpers';
import {
  createLocalModelOwner,
  getEvaluationModelIds,
  prepareModelsForExecution,
  releaseModelsForExecution,
} from '@src/local-llm/orchestrator';
import {
  buildVerifiedStatsKey,
  OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
} from '@utils/openrouterVerification';
import { runPreSendEvaluation, runPostReceiveEvaluation } from './useEvaluation';
import type { EvaluationContext } from './useEvaluation';

export function stopSession(sessionId: string) {
  stopSubmitSession(sessionId);
}

export function stopSessionsForChat(chatId: string) {
  stopSubmitSessionsForChat(chatId);
}

const useSubmit = () => {
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();
  const { t, i18n } = useTranslation('api');
  const error = useStore((state) => state.error);
  const setError = useStore((state) => state.setError);
  const apiEndpoint = useStore((state) => state.apiEndpoint);
  const apiKey = useStore((state) => state.apiKey);
  const currentChatIndex = useStore((state) => state.currentChatIndex);
  const setChats = useStore((state) => state.setChats);
  const applyBranchState = useStore((state) => state.applyBranchState);
  const invalidateBranchHistory = useStore((state) => state.invalidateBranchHistory);
  const fallbackProvider: ResolvedProvider = { endpoint: apiEndpoint, key: apiKey };
  const [isUnknownContextConfirmOpen, setIsUnknownContextConfirmOpen] = useState(false);
  const [unknownContextConfirmMessage, setUnknownContextConfirmMessage] = useState('');
  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null);

  const runSubmit = async (mode: SubmitMode, insertIndex: number | null = null, regenerate = false) => {
    if (readOnly) return;
    const chats = useStore.getState().chats;
    if (!chats) return;

    const chatIndex = currentChatIndex;
    const chatId = chats[chatIndex]?.id;
    if (!chatId) return;
    const modelResolution = resolveChatModel(chatIndex);
    const submitConfig = normalizeConfigStream({
      ...chats[chatIndex].config,
      providerId: chats[chatIndex].config.providerId ??
        (modelResolution.status === 'favorite' || modelResolution.status === 'available'
          ? modelResolution.match.providerId : undefined),
    });

    // Same-chat guard
    if (isChatGenerating(chatId)) return;

    const initialState = useStore.getState();
    const isLocal = isLocalModelConfig(submitConfig);
    let resolved: ResolvedProvider | undefined;
    try { resolved = isLocal ? undefined : resolveProviderForModel(submitConfig.model, initialState.favoriteModels, initialState.providers, fallbackProvider, submitConfig.providerId); } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (resolved?.providerId) submitConfig.providerId = resolved.providerId;
    const currentContext = getModelContextInfo(submitConfig.model, submitConfig.providerId, submitConfig.modelSource);
    const outputLimit = getModelOutputLimit(submitConfig.model, submitConfig.providerId, submitConfig.modelSource);
    if ((outputLimit !== undefined && submitConfig.max_tokens > outputLimit) ||
        (!currentContext.isFallback && submitConfig.max_tokens > getMaxCompletionTokensForContext(currentContext.contextLength))) {
      setError(i18next.t('model:modelUpdate.exceedsLimit') as string);
      return;
    }


    const sessionId = uuidv4();
    const abortController = createSubmitAbortController(sessionId);

    const { updatedChats, messageIndex, targetNodeId, contentStore } = insertAssistantPlaceholder(
      chats,
      chatIndex,
      mode,
      useStore.getState().contentStore,
      insertIndex
    );
    applyBranchState(updatedChats, contentStore, { recordHistory: false });
    invalidateBranchHistory([chatId]);

    const session = buildGeneratingSession(
      sessionId,
      chatId,
      chatIndex,
      messageIndex,
      targetNodeId,
      mode,
      mode === 'midchat' ? messageIndex : null
    );
    useStore.getState().addSession(session);
    useStore.getState().setLastSubmitContext(
      mode,
      mode === 'midchat' ? messageIndex : null,
      chatIndex,
      chatId
    );

    const apiVersion = initialState.apiVersion;
    const prefillKey = mode === 'append' ? '__sticky__' : (chats[chatIndex].branchTree?.activePath[(insertIndex ?? 1) - 1] ?? '__sticky__');
    const assistantPrefill = initialState.assistantPrefillMap[prefillKey]?.trim() || undefined;
    const titleSettings = { titleModel: initialState.titleModel, titleProviderId: initialState.titleProviderId, favoriteModels: initialState.favoriteModels, providers: initialState.providers };
    const evaluationSettings = initialState.evaluationSettings;
    const ticket = beginAiTask({ requestId: sessionId, chatId, nodeId: targetNodeId, kind: 'generation', dependencyIds: updatedChats[chatIndex].branchTree?.activePath.slice(0, messageIndex) ?? [], cancel: () => stopSubmitSession(sessionId) });
    let localModelOwnerId: string | null = null;
    let unregisterOwner: (() => void) | undefined;
    try {
      const contextMessages = getSubmitContextMessages(
        updatedChats[chatIndex].messages,
        mode,
        messageIndex,
        submitConfig.model,
        chatIndex,
        submitConfig.systemPrompt
      );

      if (contextMessages.length === 0)
        throw new Error(t('errors.noMessagesSubmitted') as string);
      if (!hasMeaningfulMessageContent(contextMessages))
        throw new Error(t('errors.noMessagesSubmitted') as string);

      await loadEncoder();
      const { contextLength: modelContextLength } = getModelContextInfo(
        submitConfig.model,
        submitConfig.providerId,
        submitConfig.modelSource
      );
      const completionBudget = submitConfig.max_tokens;
      const promptBudget = getPromptBudgetForContext(modelContextLength, completionBudget);
      const messages = await limitMessageTokens(
        contextMessages,
        promptBudget,
        submitConfig.model
      );
      if (messages.length === 0)
        throw new Error(t('errors.messageExceedMaxToken') as string);

      const promptTokens = await countTokens(messages, submitConfig.model);
      if (!fitsContextWindow(promptTokens, modelContextLength, completionBudget))
        throw new Error(t('errors.messageExceedMaxToken') as string);

      if (!isAiTaskCurrent(ticket)) return;

      if (hardOpenRouterConstraints(submitConfig.openRouter) && evaluationSettings.safetyPreSend === 'auto' && evaluationSettings.safetyEngine !== 'local') {
        throw new Error(i18next.t('model:openRouter.errors.safety') as string);
      }
      // Pre-send evaluation (async, non-blocking)
      const userMsg = [...messages].reverse().find((m) => m.role === 'user');
      const evalCtx: EvaluationContext = {
        providerId: resolved?.providerId,
        chatId,
        nodeId: targetNodeId,
        parentTicket: ticket,
        endpoint: resolved?.endpoint ?? '',
        apiKey: resolved?.key,
        model: submitConfig.model,
        openRouter: submitConfig.openRouter,
      };

      if (isLocal) {
        const evalModelIds = await getEvaluationModelIds();
        const allRequired = [submitConfig.model, ...evalModelIds].filter(Boolean);
        localModelOwnerId = createLocalModelOwner(`submit:${sessionId}`);
        unregisterOwner = localModelRuntime.registerOwnerCancellation(localModelOwnerId, () => stopSubmitSession(sessionId));
        await prepareModelsForExecution(localModelOwnerId, allRequired, { signal: abortController.signal });
      }

      if (!isAiTaskCurrent(ticket) || abortController.signal.aborted) return;
      if (userMsg) {
        runPreSendEvaluation(userMsg.content, evalCtx).catch(() => {});
      }

      // Execute generation
      let streamResult: { generationId?: string } = {};
      if (isLocal) {
        await executeLocalSubmit({
          ticket,
          sessionId,
          chatId,
          chatIndex,
          messageIndex,
          targetNodeId,
          messages,
          config: submitConfig,
          mode,
          abortController,
          t: (key: string) => t(key) as string,
          assistantPrefill,
          modelOwnerId: localModelOwnerId ?? undefined,
        });
      } else {
        streamResult = await executeSubmitStream({
          ticket,
          sessionId,
          chatId,
          chatIndex,
          messageIndex,
          targetNodeId,
          messages,
          config: submitConfig,
          resolvedProvider: resolved!,
          regenerate,
          abortController,
          apiVersion,
          t: (key: string) => t(key) as string,
        });
        if (isAiTaskCurrent(ticket)) await applySubmitTokenUsage(chatId, targetNodeId);
      }

      if (!isAiTaskCurrent(ticket) || abortController.signal.aborted) return;
      // Post-receive evaluation (async, non-blocking)
      if (userMsg) {
        const postChats = useStore.getState().chats;
        const postChat = postChats?.find(chat => chat.id === chatId);
        const postIndex = postChat?.branchTree?.activePath.indexOf(targetNodeId) ?? -1;
        const assistantMsg = postChat?.messages[postIndex];
        if (assistantMsg) {
          runPostReceiveEvaluation(userMsg.content, assistantMsg.content, evalCtx).catch(() => {});
        }
      }

      if (
        streamResult.generationId &&
        submitConfig.providerId === 'openrouter'
      ) {
        useStore.getState().queueVerification(
          buildVerifiedStatsKey(chatId, targetNodeId),
          {
            generationId: streamResult.generationId,
            chatId,
            targetNodeId,
            nextAttemptAt: Date.now() + OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
          }
        );
      }

      if (mode === 'append') {
        await maybeGenerateAutoTitle({
          chatId,
          language: i18n.language,
          setChats,
          apiVersion,
          sourceConfig: submitConfig,
          ...titleSettings,
          t: (key: string) => t(key) as string,

          fallbackProvider,
        });
      }
      useStore.getState().setLastSubmitContext(null, null, null, null);
    } catch (e: unknown) {
      const generationId = getGenerationIdFromSubmitError(e);
      if (
        generationId &&
        submitConfig.providerId === 'openrouter'
      ) {
        useStore.getState().queueVerification(
          buildVerifiedStatsKey(chatId, targetNodeId),
          {
            generationId,
            chatId,
            targetNodeId,
            nextAttemptAt: Date.now() + OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
          }
        );
      }
      if (isAiTaskCurrent(ticket)) setError((e as Error).message);
    } finally {
      unregisterOwner?.();
      if (localModelOwnerId) releaseModelsForExecution(localModelOwnerId);
      useStore.getState().removeSession(sessionId);
      clearSubmitSessionRuntime(sessionId);
      finishAiTask(ticket);
      // Clear the prefill that was consumed (if any local generation happened)
      if (isLocal && useStore.getState().assistantPrefillMap[prefillKey]?.trim() === assistantPrefill) {
        useStore.getState().clearAssistantPrefill(prefillKey);
      }
    }
  };

  const runSubmitWithConfirmation = async (
    action: () => Promise<void>,
    model: string,
    providerId?: string,
    modelSource?: 'remote' | 'local'
  ) => {
    const { isFallback } = getModelContextInfo(model, providerId as never, modelSource);
    if (!isFallback) {
      await action();
      return;
    }

    pendingSubmitRef.current = action;
    setUnknownContextConfirmMessage(
      t('warnings.unknownContextLengthBeforeSubmitConfirm', { model }) as string
    );
    setIsUnknownContextConfirmOpen(true);
  };

  const handleUnknownContextConfirm = async () => {
    const pending = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    setIsUnknownContextConfirmOpen(false);
    setUnknownContextConfirmMessage('');
    if (pending) {
      await pending();
    }
  };

  const handleUnknownContextCancel = () => {
    pendingSubmitRef.current = null;
    setIsUnknownContextConfirmOpen(false);
    setUnknownContextConfirmMessage('');
  };

  const submitWithConfirmation = async (mode: SubmitMode, insertIndex: number | null, regenerate = false) => {
    if (readOnly) return;
    const chats = useStore.getState().chats;
    const chatIndex = useStore.getState().currentChatIndex;
    const config = chats?.[chatIndex]?.config;
    if (!config) return;
    if (!confirmChatModelFavorite(chatIndex)) return;
    await runSubmitWithConfirmation(
      () => runSubmit(mode, insertIndex, regenerate),
      config.model,
      config.providerId,
      config.modelSource
    );
  };

  const handleSubmit = () => submitWithConfirmation('append', null);
  const handleSubmitMidChat = (insertIndex: number) => submitWithConfirmation('midchat', insertIndex);
  const handleRegenerate = (mode: SubmitMode, insertIndex: number | null = null) =>
    submitWithConfirmation(mode, insertIndex, true);

  const handleRetry = async () => {
    const { lastSubmitMode, lastSubmitIndex, lastSubmitChatIndex, lastSubmitChatId } = useStore.getState();
    if (!lastSubmitMode || lastSubmitChatIndex === null || !lastSubmitChatId) return;

    if (currentChatIndex !== lastSubmitChatIndex) return;
    if (isChatGenerating(lastSubmitChatId)) return;

    if (readOnly) return;
    const chats = useStore.getState().chats;
    if (!chats) return;
    if (!confirmChatModelFavorite(currentChatIndex)) return;

    if (lastSubmitMode === 'append') {
      const chat = chats[currentChatIndex];
      const lastMsg = chat.messages[chat.messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        useStore.getState().removeMessageAtIndex(currentChatIndex, chat.messages.length - 1);
      }
      setError('');
      handleSubmit();
    } else if (lastSubmitMode === 'midchat' && lastSubmitIndex !== null) {
      const chat = chats[currentChatIndex];
      const targetMsg = chat.messages[lastSubmitIndex];
      if (targetMsg?.role === 'assistant') {
        useStore.getState().removeMessageAtIndex(currentChatIndex, lastSubmitIndex);
      }
      setError('');
      handleSubmitMidChat(lastSubmitIndex);
    }
  };

  return {
    handleSubmit,
    handleSubmitMidChat,
    handleRegenerate,
    handleRetry,
    error,
    isUnknownContextConfirmOpen,
    setIsUnknownContextConfirmOpen,
    unknownContextConfirmMessage,
    handleUnknownContextConfirm,
    handleUnknownContextCancel,
  };
};

export default useSubmit;
