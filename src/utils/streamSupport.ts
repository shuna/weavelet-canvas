import { normalizeConfigStream as normalize } from './streamSupportCore';
import { isModelStreamSupported as lookupStreamSupport } from '@utils/modelLookup';
import { getModelDefaultMaxTokens } from '@utils/modelLookup';
import { ConfigInterface } from '@type/chat';
import type { ProviderId } from '@type/provider';

export const isModelStreamSupported = (model: string, providerId?: ProviderId, modelSource?: 'remote' | 'local'): boolean => {
  if (modelSource === 'local') return true;
  return lookupStreamSupport(model, providerId);
};

export const getEffectiveStreamEnabled = (config: ConfigInterface): boolean =>
  isModelStreamSupported(config.model, config.providerId, config.modelSource) && config.stream !== false;

export const normalizeConfigStream = (config: ConfigInterface): ConfigInterface =>
  normalize(config, getModelDefaultMaxTokens, isModelStreamSupported);
