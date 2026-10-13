import { buildLocalChatMessages as buildSharedLocalChatMessages } from '@utils/localGenerationInput';
import {
  filterOmittedMessages as filterSharedOmittedMessages,
  getSubmitContextMessages as getSharedSubmitContextMessages,
  modelSupportsSystemRole,
} from '@utils/submitContext';
export { sanitizeMessagesForSubmit } from '@utils/submitContext';
import { beginAiTask, finishAiTask, isAiTaskCurrent } from './aiTaskLifetime';
import { assertAuxiliaryEndpoint, hardOpenRouterConstraints } from '@utils/openrouterControls';
import { getChatCompletion } from '@api/api';
import { officialAPIEndpoint } from '@constants/auth';
import useStore, { type StoreState } from '@store/store';
import { cloneChatAtIndex } from '@utils/chatShallowClone';
import { ContentStoreData } from '@utils/contentStore';
import { countTokens, updateTotalTokenUsed } from '@utils/messageUtils';
import { getModelContextInfo } from '@utils/modelLookup';
import { fitsContextWindow } from '@utils/tokenBudget';
import {
  ChatInterface,
  ConfigInterface,
  GeneratingSession,
  MessageInterface,
  ModelOptions,
  TextContentInterface,
} from '@type/chat';
import { FavoriteModel, ProviderConfig, ProviderId } from '@type/provider';
import { normalizeProviderConfig } from '@store/provider-helpers';
import { isSummaryEligible, normalizeBubbleSummaryText } from '@utils/bubbleSummary';
import { buildBubbleSummaryPrompt } from '@utils/bubbleSummaryPrompt';

type ProviderMap = Partial<Record<ProviderId, ProviderConfig>>;

const generatingNodeIdsForChat = (chatId: string) =>
  Object.values(useStore.getState().generatingSessions).filter(session => session.chatId === chatId).map(session => session.targetNodeId);

const effectiveSummaryChat = (chat: ChatInterface, chatIndex: number): ChatInterface => {
  const state = useStore.getState();
  return { ...chat, omittedNodes: state.omittedNodeMaps[String(chatIndex)] ?? chat.omittedNodes ?? {} };
};

export type ResolvedProvider = {
  endpoint: string;
  key?: string;
};
export type SubmitMode = 'append' | 'midchat';

export { createAssistantPlaceholder, insertAssistantPlaceholder } from '@utils/generationPlan';

export const buildGeneratingSession = (
  sessionId: string,
  chatId: string,
  chatIndex: number,
  messageIndex: number,
  targetNodeId: string,
  mode: 'append' | 'midchat',
  insertIndex: number | null
): GeneratingSession => ({
  sessionId,
  chatId,
  chatIndex,
  messageIndex,
  targetNodeId,
  mode,
  insertIndex,
  requestPath: 'sw',
  startedAt: Date.now(),
});

export const resolveProviderForModel = (
  modelId: string,
  favoriteModels: FavoriteModel[],
  providers: ProviderMap,
  fallback: ResolvedProvider,
  providerId?: ProviderId
): ResolvedProvider => {
  // If providerId is specified, resolve directly
  if (providerId) {
    const provider = normalizeProviderConfig(providerId, providers[providerId]);
    return { endpoint: provider.endpoint, key: provider.apiKey };
  }

  // Fallback to favoriteModels lookup
  const favorite = favoriteModels.find((entry) => entry.modelId === modelId);
  if (!favorite) return fallback;

  const provider = normalizeProviderConfig(
    favorite.providerId,
    providers[favorite.providerId]
  );

  return {
    endpoint: provider.endpoint,
    key: provider.apiKey,
  };
};

export const filterOmittedMessages = (
  messages: MessageInterface[],
  chatIndex: number,
  state: StoreState = useStore.getState()
): MessageInterface[] => {
  const chat = state.chats?.[chatIndex];
  return filterSharedOmittedMessages(messages, chat?.branchTree?.activePath,
    state.omittedNodeMaps[String(chatIndex)] ?? chat?.omittedNodes ?? {});
};

export const getSubmitContextMessages = (
  messages: MessageInterface[],
  _mode: SubmitMode,
  messageIndex: number,
  modelId?: string,
  chatIndex?: number,
  systemPrompt?: string,
  state: StoreState = useStore.getState()
): MessageInterface[] => {
  if (chatIndex === undefined) {
    return getSharedSubmitContextMessages(messages, messageIndex, modelId, undefined, {}, systemPrompt);
  }
  const chat = state.chats?.[chatIndex];
  return getSharedSubmitContextMessages(messages, messageIndex, modelId,
    chat?.branchTree?.activePath,
    state.omittedNodeMaps[String(chatIndex)] ?? chat?.omittedNodes ?? {}, systemPrompt,
    chat ? { chat, generatingNodeIds: Object.values(state.generatingSessions)
      .filter(session => session.chatId === chat.id).map(session => session.targetNodeId) } : undefined);
};

export const applySubmitTokenUsage = async (
  chatId: string,
  targetNodeId: string
): Promise<void> => {
  const state = useStore.getState();
  if (!state.countTotalTokens || !state.chats) return;

  const chatIndex = state.chats.findIndex((chat) => chat.id === chatId);
  if (chatIndex < 0) return;

  const chat = state.chats[chatIndex];
  const assistantMessageIndex = chat.branchTree?.activePath.indexOf(targetNodeId) ?? -1;
  if (assistantMessageIndex < 0) return;

  const config = chat.config;
  const observation = chat.branchTree?.nodes[targetNodeId]?.openRouterObservation;
  if (observation?.promptTokens !== undefined && observation.completionTokens !== undefined) {
    const key = config.providerId ? `${config.model}:::${config.providerId}` : config.model;
    const total = state.totalTokenUsed[key] ?? { promptTokens: 0, completionTokens: 0, imageTokens: 0 };
    state.setTotalTokenUsed({ ...state.totalTokenUsed, [key]: {
      ...total, promptTokens: total.promptTokens + observation.promptTokens,
      completionTokens: total.completionTokens + observation.completionTokens,
    } });
    return;
  }
  const messages = chat.messages;
  const assistantMessage = messages[assistantMessageIndex];
  if (!assistantMessage) return;

  const promptMessages = getSubmitContextMessages(messages, 'append', assistantMessageIndex, config.model, chatIndex, config.systemPrompt);


  await updateTotalTokenUsed(
    config.model,
    promptMessages,
    assistantMessage,
    config.providerId
  );
};

type TitleGenerationDeps = {
  apiVersion?: string;
  titleModel?: string;
  titleProviderId?: ProviderId;
  t: (key: string) => string;
  favoriteModels: FavoriteModel[];
  providers: ProviderMap;
  fallbackProvider: ResolvedProvider;
};

export const generateTitleForChat = async (
  messages: MessageInterface[],
  modelConfig: ConfigInterface,
  deps: TitleGenerationDeps
): Promise<string> => {
  try {
    const titleModel = deps.titleModel ?? modelConfig.model;
    const titleProviderId = deps.titleModel ? deps.titleProviderId : modelConfig.providerId;
    const titleChatConfig = { ...modelConfig, model: titleModel, providerId: titleProviderId, openRouter: { routing: hardOpenRouterConstraints(modelConfig.openRouter), responseCache: { mode: 'off' as const } } };
    const resolved = resolveProviderForModel(
      titleModel,
      deps.favoriteModels,
      deps.providers,
      deps.fallbackProvider,
      titleProviderId
    );

    assertAuxiliaryEndpoint(modelConfig.openRouter, resolved.endpoint);
    if ((!resolved.key || resolved.key.length === 0) && resolved.endpoint === officialAPIEndpoint) {
      throw new Error(deps.t('noApiKeyWarning'));
    }

    const data = await getChatCompletion(
      resolved.endpoint,
      messages,
      titleChatConfig,
      resolved.key,
      undefined,
      deps.apiVersion,
      undefined,
      { auxiliary: true }
    );
    return data.choices[0].message.content;
  } catch (error: unknown) {
    throw new Error(
      `${deps.t('errors.errorGeneratingTitle')}\n${(error as Error).message}`
    );
  }
};

/** Auxiliary request with the same endpoint, key and OpenRouter restrictions as title generation. */
export const generateBubbleSummary = async (
  chat: ChatInterface,
  sourceIndexes: number[],
  deps: TitleGenerationDeps & { summaryConfig?: ConfigInterface; summaryFormat?: 'compact' },
  signal?: AbortSignal
): Promise<string> => {
  const modelConfig = deps.summaryConfig ?? chat.config;
  if (isLocalModelConfig(modelConfig)) throw new Error('ローカルモデルでは要約生成を利用できません');
  const messages = sourceIndexes.map(index => chat.messages[index]).filter(isSummaryEligible);
  if (messages.length !== sourceIndexes.length) throw new Error('要約対象にできないバブルが含まれています');
  const model = modelConfig.model;
  const resolved = resolveProviderForModel(model, deps.favoriteModels, deps.providers, deps.fallbackProvider, modelConfig.providerId);
  assertAuxiliaryEndpoint(modelConfig.openRouter, resolved.endpoint);
  if ((!resolved.key || resolved.key.length === 0) && resolved.endpoint === officialAPIEndpoint) throw new Error(deps.t('noApiKeyWarning'));
  const config = { ...modelConfig, openRouter: { routing: hardOpenRouterConstraints(modelConfig.openRouter), responseCache: { mode: 'off' as const } } };
  const request: MessageInterface[] = [{ role: 'user', content: [{ type: 'text', text: buildBubbleSummaryPrompt(messages, deps.summaryFormat) }] }];
  const context = getModelContextInfo(model, modelConfig.providerId, modelConfig.modelSource).contextLength;
  if (!fitsContextWindow(await countTokens(request, model), context, modelConfig.max_tokens)) throw new Error('要約対象がモデルのコンテキスト上限を超えています');
  const data = await getChatCompletion(resolved.endpoint, request, config, resolved.key, undefined, deps.apiVersion, signal, { auxiliary: true });
  const text = normalizeBubbleSummaryText(data.choices[0]?.message.content ?? '');
  if (!text) throw new Error('要約を生成できませんでした');
  await updateTotalTokenUsed(model, request, { role: 'assistant', content: [{ type: 'text', text }] }, modelConfig.providerId);
  if (data.choices[0]?.finish_reason === 'length') throw new Error('出力上限で要約が途中で終了しました。上限を調整して生成し直してください');
  return text;
};

export const buildTitlePromptMessage = (
  userMessage: MessageInterface['content'],
  assistantMessage: MessageInterface['content'],
  language: string
): MessageInterface => ({
  role: 'user',
  content: [
    ...userMessage,
    ...assistantMessage,
    {
      type: 'text',
      text: `Generate a title in less than 6 words for the conversation so far (language: ${language})`,
    } as TextContentInterface,
  ],
});

export const setGeneratedTitle = (
  chats: { title: string; titleSet: boolean }[],
  chatIndex: number,
  title: string
) => {
  chats[chatIndex].title = title;
  chats[chatIndex].titleSet = true;
};

type AutoTitleDeps = TitleGenerationDeps & {
  sourceConfig?: ConfigInterface;
  chatId: string;
  language: string;
  setChats: (chats: ChatInterface[]) => void;
};

export const maybeGenerateAutoTitle = async ({
  chatId,
  language,
  setChats,
  sourceConfig,
  ...deps
}: AutoTitleDeps) => {
  const state = useStore.getState();
  if (!state.autoTitle || !state.chats) return;

  const chatIndex = state.chats.findIndex((chat) => chat.id === chatId);
  if (chatIndex < 0 || state.chats[chatIndex]?.titleSet) return;

  const messages = state.chats[chatIndex].messages;
  const assistantMessage = messages[messages.length - 1];
  const userMessage = messages[messages.length - 2];
  if (!assistantMessage || !userMessage) return;

  const promptMessage = buildTitlePromptMessage(
    userMessage.content,
    assistantMessage.content,
    language
  );

  const titleChats = useStore.getState().chats;
  if (!titleChats) return;

  const titleChatIndex = titleChats.findIndex((chat) => chat.id === chatId);
  if (titleChatIndex < 0) return;

  const ticket = beginAiTask({ requestId: crypto.randomUUID(), kind: 'title', chatId, dependencyIds: [] });
  let title: string;
  try {
    title = (await generateTitleForChat([promptMessage], sourceConfig ?? titleChats[titleChatIndex].config, deps)).trim();
    if (!isAiTaskCurrent(ticket)) return;
  } finally {
    finishAiTask(ticket);
  }
  if (title.startsWith('"') && title.endsWith('"')) title = title.slice(1, -1);
  const latestChats = useStore.getState().chats!;
  const latestIndex = latestChats.findIndex(chat => chat.id === chatId);
  const updatedChats = cloneChatAtIndex(latestChats, latestIndex);
  setGeneratedTitle(updatedChats, latestIndex, title);
  setChats(updatedChats);

  if (useStore.getState().countTotalTokens) {
    const titleConfig = updatedChats[latestIndex].config;
    const titleTokenModel = deps.titleModel ?? titleConfig.model;
    const titleTokenProviderId = deps.titleModel ? deps.titleProviderId : titleConfig.providerId;
    await updateTotalTokenUsed(titleTokenModel as ModelOptions, [promptMessage], {
      role: 'assistant',
      content: [{ type: 'text', text: title }],
    }, titleTokenProviderId);
  }
};

// ---------------------------------------------------------------------------
// Local model helpers
// ---------------------------------------------------------------------------

/**
 * Check if a chat config is targeting a local model.
 */
export function isLocalModelConfig(config: ConfigInterface): boolean {
  return config.modelSource === 'local';
}

/**
 * Build a structured messages array for local wllama generation.
 * Returns WllamaChatMessage-compatible objects that the worker will pass
 * directly to wllama.formatChat(), enabling proper chat-template expansion.
 */
export function buildLocalChatMessages(
  messages: MessageInterface[],
  mode: SubmitMode,
  messageIndex: number,
  modelId?: string,
  chatIndex?: number,
  systemPrompt?: string,
): { role: string; content: string }[] {
  const contextMessages = getSubmitContextMessages(
    messages, mode, messageIndex, modelId, chatIndex, systemPrompt,
  );
  return buildSharedLocalChatMessages(contextMessages);
}

/**
 * Build a text prompt from submit context for local wllama generation.
 * Reuses getSubmitContextMessages() for omission, sanitization, and system prompt,
 * then converts the structured messages to a generic text prompt.
 *
 * Note: This uses a generic System:/User:/Assistant: format, not model-specific
 * prompt templates (ChatML, Alpaca, etc.). Quality may vary by model architecture.
 */
export function buildLocalPromptFromContext(
  messages: MessageInterface[],
  mode: SubmitMode,
  messageIndex: number,
  modelId?: string,
  chatIndex?: number,
  systemPrompt?: string,
): string {
  const contextMessages = getSubmitContextMessages(
    messages, mode, messageIndex, modelId, chatIndex, systemPrompt,
  );
  return contextMessages
    .map((m) => {
      const text = m.content
        .filter((c): c is TextContentInterface => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      if (m.role === 'system') return `System: ${text}`;
      if (m.role === 'user') return `User: ${text}`;
      return `Assistant: ${text}`;
    })
    .join('\n\n') + '\n\nAssistant:';
}
