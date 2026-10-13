import { getCatalogModel } from '../local-llm/catalog';
import { getMaxCompletionTokensForContext } from './tokenBudget';
import type { LocalModelDefinition } from '../local-llm/types';
export type LocalModelState = {localModels?: Pick<LocalModelDefinition,'id'|'displayMeta'>[]};
export type LocalContextCapabilities = {contextLength?:number};
const DEFAULT_LOCAL_MODEL_CONTEXT_LENGTH = 2048;
export function localModelContextLength(state:LocalModelState,modelId:string,capabilities?:LocalContextCapabilities):number {
  if(capabilities?.contextLength)return capabilities.contextLength;
  const stored=state.localModels?.find(model=>model.id===modelId);
  if(stored?.displayMeta?.contextLength)return stored.displayMeta.contextLength;
  const catalog=getCatalogModel(modelId);
  if(catalog?.displayMeta?.contextLength)return catalog.displayMeta.contextLength;
  return DEFAULT_LOCAL_MODEL_CONTEXT_LENGTH;
}
export const localModelDefaultMaxTokens = (state:LocalModelState,modelId:string,capabilities?:LocalContextCapabilities):number =>
  getMaxCompletionTokensForContext(localModelContextLength(state,modelId,capabilities));
