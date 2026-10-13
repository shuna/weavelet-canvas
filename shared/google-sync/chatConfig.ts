import { localModelDefaultMaxTokens, type LocalModelState, type LocalContextCapabilities } from '../../src/utils/localModelLimits';
import type { ConfigInterface } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';
import { remoteModelDefaultMaxTokens, remoteModelStreamSupported } from '../../src/utils/remoteModelLimits';
import { switchConfigModel } from '../../src/utils/modelSettingsCore';
import { normalizeConfigStream } from '../../src/utils/streamSupportCore';
import { diffJSONChanges } from '../../src/utils/jsonChanges';

export function normalizeRemoteConfig(config: ConfigInterface, modelState: ReasoningModelState): ConfigInterface {
  if (config.modelSource === 'local') throw new Error('Local model configuration is not supported by this remote adapter.');
  return normalizeConfigStream(config,
    (model, providerId) => remoteModelDefaultMaxTokens(modelState, model, providerId),
    (model, providerId) => remoteModelStreamSupported(modelState, model, providerId));
}
export function chatConfig(json: string): string {
  const input = JSON.parse(json) as { operation: 'switch' | 'normalize'; config: ConfigInterface;
    target?: Pick<ConfigInterface, 'model' | 'providerId' | 'modelSource'>; modelState?: ReasoningModelState & LocalModelState; localCapabilities?:Record<string,LocalContextCapabilities> };
  const state = input.modelState ?? {};
  let config = input.config;
  const defaultMaxTokens = (model:string,providerId?:ConfigInterface['providerId'],source?:ConfigInterface['modelSource']) => source==='local'
    ?localModelDefaultMaxTokens(state,model,input.localCapabilities?.[model]):remoteModelDefaultMaxTokens(state,model,providerId);
  if (input.operation === 'switch') {
    if (!input.target) throw new Error('Missing model target.');
    config = switchConfigModel(config, { model: input.target.model, providerId: input.target.providerId, modelSource: input.target.modelSource },
      defaultMaxTokens);
  } else if (input.operation !== 'normalize') throw new Error('Unknown chat config operation.');
  const next = normalizeConfigStream(config,defaultMaxTokens,(model,providerId,source)=>source==='local'?true:remoteModelStreamSupported(state,model,providerId));
  return JSON.stringify({ changes: diffJSONChanges(input.config, JSON.parse(JSON.stringify(next))) });
}
