import { getModelDefaultMaxTokens } from './modelLookup';
import { savedModelSettings as saved, switchConfigModel as switchModel } from './modelSettingsCore';
import type { ConfigInterface } from '@type/chat';
export { pickModelSettings, defaultOpenRouterSettings } from './modelSettingsCore';
export const savedModelSettings = (config: ConfigInterface, target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>) =>
  saved(config, target, getModelDefaultMaxTokens);
export const switchConfigModel = (config: ConfigInterface, target: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>) =>
  switchModel(config, target, getModelDefaultMaxTokens);
