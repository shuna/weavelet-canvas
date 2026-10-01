import { _defaultChatConfig } from '@constants/chat';
import { getModelDefaultMaxTokens } from './modelLookup';
import type { ConfigInterface, ModelSettings } from '@type/chat';

const modelKey = ({ model, providerId, modelSource }: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>) =>
  JSON.stringify([modelSource === 'local' ? 'local' : 'remote', providerId ?? '', model]);

export const pickModelSettings = (config: ConfigInterface): ModelSettings => ({
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
): ModelSettings =>
  modelKey(config) === modelKey(target)
    ? pickModelSettings(config)
    : config.modelSettings?.[modelKey(target)] ?? {
        ...pickModelSettings(_defaultChatConfig),
        max_tokens: getModelDefaultMaxTokens(target.model, target.providerId, target.modelSource),
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
