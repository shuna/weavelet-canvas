import { isModelStreamSupported as lookupStreamSupport } from '@utils/modelLookup';
import { getModelDefaultMaxTokens } from '@utils/modelLookup';
import { defaultUserMaxToken } from '@constants/chat';
import { ConfigInterface } from '@type/chat';
import type { ProviderId } from '@type/provider';

export const isModelStreamSupported = (model: string, providerId?: ProviderId, modelSource?: 'remote' | 'local'): boolean => {
  if (modelSource === 'local') return true;
  return lookupStreamSupport(model, providerId);
};

export const getEffectiveStreamEnabled = (config: ConfigInterface): boolean =>
  isModelStreamSupported(config.model, config.providerId, config.modelSource) && config.stream !== false;

export const normalizeConfigStream = (
  config: ConfigInterface
): ConfigInterface => ({
  ...config,
  max_tokens: config.max_tokens === defaultUserMaxToken
    ? getModelDefaultMaxTokens(config.model, config.providerId, config.modelSource)
    : config.max_tokens,
  stream: isModelStreamSupported(config.model, config.providerId, config.modelSource) ? config.stream !== false : false,
});
