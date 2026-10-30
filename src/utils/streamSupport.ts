import { isModelStreamSupported as lookupStreamSupport } from '@utils/modelLookup';
import { ConfigInterface } from '@type/chat';
import type { ProviderId } from '@type/provider';

export const isModelStreamSupported = (model: string, providerId?: ProviderId, modelSource?: 'remote' | 'local'): boolean => {
  if (modelSource === 'local') return true;
  return lookupStreamSupport(model, providerId);
};

export const getEffectiveStreamEnabled = (config: ConfigInterface): boolean =>
  isModelStreamSupported(config.model, config.providerId, config.modelSource) && config.stream !== false;

// Capability refreshes must not rewrite a chat's saved generation settings.
export const normalizeConfigStream = (config: ConfigInterface): ConfigInterface => config;
