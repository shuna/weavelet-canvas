import { defaultUserMaxToken } from '@constants/chatDefaults';
import type { ConfigInterface } from '@type/chat';
import type { ProviderId } from '@type/provider';

export const normalizeConfigStream = (
  config: ConfigInterface,
  getModelDefaultMaxTokens: (model: string, providerId?: ProviderId, modelSource?: 'remote' | 'local') => number,
  isModelStreamSupported: (model: string, providerId?: ProviderId, modelSource?: 'remote' | 'local') => boolean
): ConfigInterface => ({
  ...config,
  max_tokens: config.max_tokens === defaultUserMaxToken
    ? getModelDefaultMaxTokens(config.model, config.providerId, config.modelSource)
    : config.max_tokens,
  stream: isModelStreamSupported(config.model, config.providerId, config.modelSource) ? config.stream !== false : false,
});
