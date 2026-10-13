import { isImageContent } from '@type/chat';
import type { ChatInterface, ConfigInterface, MessageInterface, TextContentInterface, TotalTokenUsed } from '@type/chat';
import type { FavoriteModel, ProviderConfig, ProviderId } from '@type/provider';
import { normalizeProviderConfig } from '@store/provider-helpers';
import { defaultModel } from '@constants/chatDefaults';
import { hardOpenRouterConstraints } from './openrouterRequest';

export type ResolvedProvider = { endpoint: string; key?: string };
export const TITLE_DEFAULTS = { autoTitle: false, titleModel: defaultModel, titleProviderId: undefined as ProviderId | undefined };
export type TitleSettings = {
  titleModel?: string;
  titleProviderId?: ProviderId;
  favoriteModels: FavoriteModel[];
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  fallbackProvider: ResolvedProvider;
};

export const resolveProviderForModel = (
  modelId: string,
  favoriteModels: FavoriteModel[],
  providers: Partial<Record<ProviderId, ProviderConfig>>,
  fallback: ResolvedProvider,
  providerId?: ProviderId
): ResolvedProvider => {
  if (providerId) {
    const provider = normalizeProviderConfig(providerId, providers[providerId]);
    return { endpoint: provider.endpoint, key: provider.apiKey };
  }
  const favorite = favoriteModels.find(entry => entry.modelId === modelId);
  if (!favorite) return fallback;
  const provider = normalizeProviderConfig(favorite.providerId, providers[favorite.providerId]);
  return { endpoint: provider.endpoint, key: provider.apiKey };
};

export const titleRequestSettings = (config: ConfigInterface, settings: TitleSettings) => {
  const model = settings.titleModel ?? config.model;
  const providerId = settings.titleModel ? settings.titleProviderId : config.providerId;
  const credentialProviderId = providerId ?? settings.favoriteModels.find(entry => entry.modelId === model)?.providerId;
  return {
    model,
    providerId,
    credentialProviderId,
    config: { ...config, modelSource: 'remote' as const, model, providerId, openRouter: {
      routing: hardOpenRouterConstraints(config.openRouter), responseCache: { mode: 'off' as const },
    } },
    provider: resolveProviderForModel(model, settings.favoriteModels, settings.providers, settings.fallbackProvider, providerId),
  };
};

export const buildTitlePromptMessage = (
  userMessage: MessageInterface['content'], assistantMessage: MessageInterface['content'], language: string
): MessageInterface => ({
  role: 'user',
  content: [...userMessage, ...assistantMessage, {
    type: 'text', text: `Generate a title in less than 6 words for the conversation so far (language: ${language})`,
  } as TextContentInterface],
});

export const autoTitlePrompt = (chat: ChatInterface, enabled: boolean, language: string): MessageInterface | undefined => {
  if (!enabled || chat.titleSet) return;
  const assistant = chat.messages.at(-1), user = chat.messages.at(-2);
  if (!assistant || !user) return;
  return buildTitlePromptMessage(user.content, assistant.content, language);
};

export const normalizeGeneratedTitle = (response: string): string => {
  let title = response.trim();
  if (title.startsWith('"') && title.endsWith('"')) title = title.slice(1, -1);
  return title;
};

export const setGeneratedTitle = (chats: { title: string; titleSet: boolean }[], chatIndex: number, title: string) => {
  chats[chatIndex].title = title;
  chats[chatIndex].titleSet = true;
};

export const estimateTokensByChars = (messages: MessageInterface[]): number => Math.ceil(messages.reduce((chars, message) =>
  chars + message.role.length + 4 + message.content.reduce((partChars, part) =>
    partChars + (part.type === 'text' ? part.text.length : 0), 0), 0) / 2);

export const addTokenUsage = (total: TotalTokenUsed, model: string, providerId: string | undefined,
  promptTokens: number, completionTokens: number, imageTokens: number): TotalTokenUsed => {
  const key = providerId ? `${model}:::${providerId}` : model;
  const previous = total[key] ?? { promptTokens: 0, completionTokens: 0, imageTokens: 0 };
  const { promptTokens: priorPrompt = 0, completionTokens: priorCompletion = 0, imageTokens: priorImages = 0 } = previous;
  return { ...total, [key]: { ...previous,
    promptTokens: priorPrompt + promptTokens,
    completionTokens: priorCompletion + completionTokens,
    imageTokens: priorImages + imageTokens,
  } };
};

export const countImageInputs = (messages: MessageInterface[]): number =>
  messages.reduce(
    (total, message) =>
      total +
      message.content.reduce(
        (count, content) => count + (isImageContent(content) ? 1 : 0),
        0
      ),
    0
  );
