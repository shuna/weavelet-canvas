import { prepareSingleGGUFImport, commitSingleGGUFImport, type SingleGGUFCandidate } from '../../src/utils/localModelImport';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { LocalModelDefinition, LocalModelTask } from '../../src/local-llm/types';

type State = {localModels: LocalModelDefinition[]; activeLocalModels: Partial<Record<LocalModelTask, string>>};
type Input =
  | {operation:'prepare'; name:string; hash:string; size:number; candidates?:SingleGGUFCandidate[]; existingModel?:LocalModelDefinition; existingIDs?:string[]}
  | {operation:'commit'; state:State; model:LocalModelDefinition; existingIDs?:string[]};

export function localModelImport(json:string):string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'prepare') return JSON.stringify(prepareSingleGGUFImport(input.name,input.hash,input.size,input.candidates,input.existingModel,input.existingIDs));
  const before = {localModels:input.state.localModels,activeLocalModels:input.state.activeLocalModels};
  return JSON.stringify({changes:diffJSONChanges(before,commitSingleGGUFImport(before,input.model,input.existingIDs))});
}
