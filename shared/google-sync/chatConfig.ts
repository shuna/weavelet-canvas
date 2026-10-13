import { localModelContextLength, localModelDefaultMaxTokens, type LocalModelState, type LocalContextCapabilities } from '../../src/utils/localModelLimits';
import type { ConfigInterface } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';
import { remoteModelContextInfo, remoteModelDefaultMaxTokens, remoteModelStreamSupported } from '../../src/utils/remoteModelLimits';
import { switchConfigModel } from '../../src/utils/modelSettingsCore';
import { normalizeConfigStream } from '../../src/utils/streamSupportCore';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { clampCompletionTokens, UNKNOWN_MODEL_UI_CONTEXT_LENGTH } from '../../src/utils/tokenBudget';

export function normalizeRemoteConfig(config: ConfigInterface, modelState: ReasoningModelState): ConfigInterface {
  if (config.modelSource === 'local') throw new Error('Local model configuration is not supported by this remote adapter.');
  return normalizeConfigStream(config,
    (model, providerId) => remoteModelDefaultMaxTokens(modelState, model, providerId),
    (model, providerId) => remoteModelStreamSupported(modelState, model, providerId));
}
export function normalizeChatConfig(config: ConfigInterface, modelState: ReasoningModelState & LocalModelState = {}, localCapabilities?:Record<string,LocalContextCapabilities>): ConfigInterface {
  const defaultMaxTokens = (model:string,providerId?:ConfigInterface['providerId'],source?:ConfigInterface['modelSource']) => source==='local'
    ?localModelDefaultMaxTokens(modelState,model,localCapabilities?.[model]):remoteModelDefaultMaxTokens(modelState,model,providerId);
  return normalizeConfigStream(config,defaultMaxTokens,(model,providerId,source)=>source==='local'?true:remoteModelStreamSupported(modelState,model,providerId));
}
export function saveDefaultChatConfig(config: ConfigInterface, modelState: ReasoningModelState & LocalModelState = {}, localCapabilities?:Record<string,LocalContextCapabilities>): ConfigInterface {
  const contextLength = config.modelSource === 'local'
    ? localModelContextLength(modelState, config.model, localCapabilities?.[config.model])
    : (() => { const info = remoteModelContextInfo(modelState, config.model, config.providerId); return info.isFallback ? UNKNOWN_MODEL_UI_CONTEXT_LENGTH : info.contextLength; })();
  return normalizeChatConfig(config.max_tokens === undefined ? config : { ...config, max_tokens: clampCompletionTokens(config.max_tokens, contextLength) }, modelState, localCapabilities);
}
export function chatConfig(json: string): string {
  const input = JSON.parse(json) as { operation: 'switch' | 'normalize' | 'saveDefaults'; config: ConfigInterface;
    target?: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>; modelState?: ReasoningModelState & LocalModelState; localCapabilities?:Record<string,LocalContextCapabilities> };
  let config = input.config;
  const state = input.modelState ?? {};
  if (input.operation === 'switch') {
    if (!input.target) throw new Error('Missing model target.');
    config = switchConfigModel(config, { model: input.target.model, providerId: input.target.providerId, modelSource: input.target.modelSource },
      (model,providerId,source) => source==='local'
        ?localModelDefaultMaxTokens(state,model,input.localCapabilities?.[model]):remoteModelDefaultMaxTokens(state,model,providerId));
  } else if (input.operation !== 'normalize' && input.operation !== 'saveDefaults') throw new Error('Unknown chat config operation.');
  const next = input.operation === 'saveDefaults'
    ? saveDefaultChatConfig(config, state, input.localCapabilities)
    : normalizeChatConfig(config, state, input.localCapabilities);
  return JSON.stringify({ changes: diffJSONChanges(input.config, JSON.parse(JSON.stringify(next))) });
}
