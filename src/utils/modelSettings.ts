import { _defaultChatConfig } from '@constants/chat';
import { getModelCapabilities, getModelContextInfo, isModelStreamSupported } from './modelLookup';
import useStore from '@store/store';
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

export const commonModelSettings = (
  target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>
): ModelSettings => {
  const shared = useStore.getState().defaultChatConfig;
  const defaults = pickModelSettings(shared ?? _defaultChatConfig);
  const modelLimit = getModelDefaultMaxTokens(target.model, target.providerId, target.modelSource);
  return {
    ...defaults,
    openRouter: target.providerId === 'openrouter' && target.modelSource !== 'local'
      ? (shared?.providerId === 'openrouter' ? defaults.openRouter : undefined) ?? defaultOpenRouterSettings() : undefined,
    reasoning_effort: defaults.reasoning_effort ?? 'none',
    reasoning_budget_tokens: defaults.reasoning_budget_tokens ?? 0,
    force_reasoning: defaults.force_reasoning ?? false,
    stream: isModelStreamSupported(target.model, target.providerId, target.modelSource) && defaults.stream !== false,
    max_tokens: shared ? (shared.max_tokens === 0 ? 0 : Math.min(shared.max_tokens, modelLimit)) : modelLimit,
  };
};

export const commonModelRevision = (config: ConfigInterface): string => JSON.stringify([
  modelKey(config), getModelContextInfo(config.model, config.providerId, config.modelSource),
  commonModelSettings(config), getModelCapabilities(config.model, config.providerId, config.modelSource),
]);

export const savedModelSettings = (
  config: ConfigInterface,
  target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>
): ModelSettings => modelKey(config) === modelKey(target) ? pickModelSettings(config) : commonModelSettings(target);

export const switchConfigModel = (
  config: ConfigInterface,
  target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>
): ConfigInterface => {
  if (modelKey(config) === modelKey(target)) return config;
  return { ...config, ...commonModelSettings(target), ...target, modelSettings: undefined, modelReview: undefined };
};
