import { _defaultChatConfig } from '@constants/chat';
import { getModelDefaultMaxTokens } from './modelLookup';
import type { ConfigInterface, ModelSettings } from '@type/chat';

const modelKey = ({ model, providerId, modelSource }: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>) =>
  JSON.stringify([modelSource === 'local' ? 'local' : 'remote', providerId ?? '', model]);

export const defaultOpenRouterSettings = (): NonNullable<ConfigInterface['openRouter']> => ({
  responseCache: { mode: 'off' }, stickySession: true,
});

export const pickModelSettings = (config: ConfigInterface): ModelSettings => ({
  openRouter: config.openRouter ? structuredClone(config.openRouter) : undefined,
  max_tokens: config.max_tokens,
  temperature: config.temperature,
  presence_penalty: config.presence_penalty,
  top_p: config.top_p,
  frequency_penalty: config.frequency_penalty,
  stream: config.stream,
  reasoning_effort: config.reasoning_effort,
  reasoning_budget_tokens: config.reasoning_budget_tokens,
  verbosity: config.verbosity,
  force_reasoning: config.force_reasoning,
});

export const savedModelSettings = (
  config: ConfigInterface,
  target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>
): ModelSettings => {
  if (modelKey(config) === modelKey(target)) return pickModelSettings(config);
  const saved = config.modelSettings?.[modelKey(target)];
  if (saved) return { ...saved, openRouter: saved.openRouter ? structuredClone(saved.openRouter) : undefined };
  return {
    ...pickModelSettings(_defaultChatConfig),
    openRouter: target.providerId === 'openrouter' && target.modelSource !== 'local'
      ? defaultOpenRouterSettings() : undefined,
    max_tokens: getModelDefaultMaxTokens(target.model, target.providerId, target.modelSource),
  };
};

export const switchConfigModel = (
  config: ConfigInterface,
  target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>
): ConfigInterface => {
  if (modelKey(config) === modelKey(target)) return config;
  const modelSettings = {
    ...config.modelSettings,
    [modelKey(config)]: pickModelSettings(config),
  };
  return {
    ...config,
    ...savedModelSettings({ ...config, modelSettings }, target),
    ...target,
    modelSettings,
  };
};
