import { commitCatalogDuplicate, commitLocalModel, commitSelectedGGUFImport, commitSingleGGUFImport, findSelectedGGUFDuplicate, inspectSelectedGGUFs, prepareSelectedGGUFImport, prepareSingleGGUFImport, type SelectedGGUFCandidate, type SelectedGGUFFile, type SingleGGUFCandidate } from '../../src/utils/localModelImport';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { LocalModelDefinition, LocalModelTask } from '../../src/local-llm/types';
import { catalogDefinition, catalogModels, catalogPlan } from '../../src/local-llm/catalogPlan';
import { ggufFingerprintPlan } from '../../src/local-llm/modelFingerprint';

type State = {localModels: LocalModelDefinition[]; activeLocalModels: Partial<Record<LocalModelTask, string>>};
type SelectionState = State & {favoriteLocalModelIds: string[]};
type CatalogState = {localModels: unknown[]; activeLocalModels: Partial<Record<LocalModelTask, string>>; favoriteLocalModelIds: string[]; savedModelMeta: Record<string, unknown>};
type Input =
  | {operation:'prepare'; name:string; hash:string; size:number; candidates?:SingleGGUFCandidate[]; existingModel?:LocalModelDefinition; existingIDs?:string[]}
  | {operation:'selection'; files:SelectedGGUFFile[]}
  | {operation:'prepareSelection'; files:SelectedGGUFFile[]; hash:string; existingModel?:LocalModelDefinition; existingIDs?:string[]}
  | {operation:'selectionDuplicate'; files:Array<SelectedGGUFFile & {hash:string}>; candidates:SelectedGGUFCandidate[]}
  | {operation:'selectionCommit'; state:SelectionState; model:LocalModelDefinition; existingIDs?:string[]}
  | {operation:'fingerprintPlan'; size:number}
  | {operation:'commit'; state:State; model:LocalModelDefinition; existingIDs?:string[]}
  | {operation:'catalog';}
  | {operation:'catalogPlan'; id:string}
  | {operation:'catalogDefinition'; id:string; totalBytes:number}
  | {operation:'catalogCommit'; state:State; model:LocalModelDefinition; existingIDs?:string[]}
  | {operation:'catalogDuplicateCommit'; state:CatalogState; downloadedID:string; duplicate:Pick<LocalModelDefinition,'id'|'tasks'>; localModelIDs?:string[]};

export function localModelImport(json:string):string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'prepare') return JSON.stringify(prepareSingleGGUFImport(input.name,input.hash,input.size,input.candidates,input.existingModel,input.existingIDs));
  if (input.operation === 'selection') return JSON.stringify(inspectSelectedGGUFs(input.files));
  if (input.operation === 'prepareSelection') return JSON.stringify(prepareSelectedGGUFImport(inspectSelectedGGUFs(input.files),input.hash,input.existingModel,input.existingIDs));
  if (input.operation === 'selectionDuplicate') {
    const selection = inspectSelectedGGUFs(input.files);
    return JSON.stringify(findSelectedGGUFDuplicate(selection,input.files,input.candidates));
  }
  if (input.operation === 'fingerprintPlan') return JSON.stringify(ggufFingerprintPlan(input.size));
  if (input.operation === 'catalog') return JSON.stringify(catalogModels());
  if (input.operation === 'catalogPlan') return JSON.stringify(catalogPlan(input.id));
  if (input.operation === 'catalogDefinition') {
    const {model} = catalogPlan(input.id);
    return JSON.stringify(catalogDefinition(model,input.totalBytes));
  }
  if (input.operation === 'catalogDuplicateCommit') return JSON.stringify({changes:diffJSONChanges(input.state,commitCatalogDuplicate(input.state,input.downloadedID,input.duplicate,input.localModelIDs))});
  const before = {localModels:input.state.localModels,activeLocalModels:input.state.activeLocalModels};
  if (input.operation === 'selectionCommit') return JSON.stringify({changes:diffJSONChanges(input.state,commitSelectedGGUFImport(input.state,input.model,input.existingIDs))});
  if (input.operation === 'catalogCommit') return JSON.stringify({changes:diffJSONChanges(before,commitLocalModel(before,input.model,input.existingIDs))});
  return JSON.stringify({changes:diffJSONChanges(before,commitSingleGGUFImport(before,input.model,input.existingIDs))});
}
