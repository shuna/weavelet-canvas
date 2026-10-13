import { _defaultChatConfig, _defaultImageDetail, defaultSystemMessage } from '@constants/chatDefaults';
import type { ConfigInterface, ImageDetail } from '@type/chat';

export type NewChatDefaults = {
  defaultChatConfig: ConfigInterface;
  defaultSystemMessage: string;
  defaultImageDetail: ImageDetail;
};

export const newChatDefaults = (state: Partial<NewChatDefaults> = {}): NewChatDefaults => ({
  defaultChatConfig: state.defaultChatConfig ?? _defaultChatConfig,
  defaultSystemMessage: state.defaultSystemMessage ?? defaultSystemMessage,
  defaultImageDetail: state.defaultImageDetail ?? _defaultImageDetail,
});

export const newChatConfig = (config: ConfigInterface, systemPrompt?: string): ConfigInterface => ({
  ...structuredClone(config),
  reasoning_effort: config.reasoning_effort ?? 'none',
  reasoning_budget_tokens: config.reasoning_budget_tokens ?? 0,
  systemPrompt: systemPrompt || undefined,
});
