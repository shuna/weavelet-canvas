import type { ConfigInterface, ImageDetail } from '@type/chat';

export const defaultSystemMessage = "You are a large language model assistant.\nCarefully heed the user's instructions. \nRespond using Markdown.";
export const defaultModel = '';
export const defaultUserMaxToken = 4000;
export const _defaultChatConfig: ConfigInterface = {
  model: defaultModel,
  max_tokens: defaultUserMaxToken,
  temperature: 1,
  presence_penalty: 0,
  top_p: 1,
  frequency_penalty: 0,
  stream: true,
  reasoning_effort: 'none',
  reasoning_budget_tokens: 0,
};
export const _defaultImageDetail: ImageDetail = 'auto';
