import type { LocalModelDefinition, LocalModelTask } from '@src/local-llm/types';

const sanitizeModelIdSegment = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model';

export function singleGGUFDefinition(name: string, hash: string, size: number): LocalModelDefinition {
  return {
    id: `local-file--${hash.slice(0, 16)}--${sanitizeModelIdSegment(name)}`,
    engine: 'wllama',
    tasks: ['generation', 'analysis'],
    label: name,
    origin: name,
    source: 'opfs',
    manifest: {kind: 'single-file', entrypoint: name},
    fileSize: size,
    lastFileName: name,
  };
}

export function autoAssignImportedModel(active: Partial<Record<LocalModelTask, string>>, model: Pick<LocalModelDefinition, 'id' | 'tasks'>): Partial<Record<LocalModelTask, string>> {
  const next = {...active};
  for (const task of model.tasks) if (!next[task]) next[task] = model.id;
  return next;
}

export type SingleGGUFCandidate = {model: LocalModelDefinition; hash?: string; size?: number};
export function prepareSingleGGUFImport(name: string, hash: string, size: number, candidates: SingleGGUFCandidate[] = [], existingModel?: LocalModelDefinition, existingIDs?: string[]) {
  const proposed = singleGGUFDefinition(name, hash, size);
  const duplicate = existingModel ?? candidates.find(({model, hash: storedHash, size: storedSize}) =>
    model.engine === 'wllama' && model.manifest.kind === 'single-file' && storedHash === hash && (!storedSize || storedSize === size))?.model;
  if (!duplicate && (existingIDs ?? candidates.map(({model}) => model.id)).includes(proposed.id)) throw new Error('A different model already uses this ID.');
  return {model: duplicate ?? proposed, existing: !!duplicate};
}

export function commitSingleGGUFImport<T extends {localModels: LocalModelDefinition[]; activeLocalModels: Partial<Record<LocalModelTask, string>>}>(state: T, model: LocalModelDefinition, existingIDs?: string[]): T {
  const next = commitLocalModel(state, model, existingIDs);
  return {
    ...next,
    activeLocalModels: autoAssignImportedModel(next.activeLocalModels, model),
  };
}

export function commitLocalModel<T extends {localModels: LocalModelDefinition[]}>(state: T, model: LocalModelDefinition, existingIDs?: string[]): T {
  const current = existingIDs ? existingIDs.includes(model.id) : state.localModels.some(entry => entry.id === model.id);
  return {
    ...state,
    localModels: current ? state.localModels : [...state.localModels, model],
  };
}

export function commitCatalogDuplicate<T extends {
  localModels: unknown[];
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
  favoriteLocalModelIds: string[];
  savedModelMeta: Record<string, unknown>;
}>(state: T, downloadedID: string, duplicate: Pick<LocalModelDefinition, 'id' | 'tasks'>, localModelIDs?: string[]): T {
  const activeLocalModels = {...state.activeLocalModels};
  for (const task of Object.keys(activeLocalModels) as LocalModelTask[]) {
    if (activeLocalModels[task] === downloadedID) delete activeLocalModels[task];
  }
  const savedModelMeta = {...state.savedModelMeta};
  delete savedModelMeta[downloadedID];
  const favoriteLocalModelIds = state.favoriteLocalModelIds.filter((id) => id !== downloadedID);
  if (!favoriteLocalModelIds.includes(duplicate.id)) favoriteLocalModelIds.push(duplicate.id);
  return {
    ...state,
    localModels: state.localModels.filter((model, index) => {
      const id = localModelIDs?.[index] ?? (typeof model === 'object' && model !== null && 'id' in model && typeof model.id === 'string' ? model.id : undefined);
      return id !== downloadedID;
    }),
    activeLocalModels: autoAssignImportedModel(activeLocalModels, duplicate),
    favoriteLocalModelIds,
    savedModelMeta,
  };
}
