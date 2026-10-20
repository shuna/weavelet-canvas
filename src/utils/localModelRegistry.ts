import type { LocalModelTask } from '@src/local-llm/types';

export type LocalModelRegistryState<Model = unknown, Meta = unknown> = {
  localModels: Model[];
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
  favoriteLocalModelIds: string[];
  savedModelMeta: Record<string, Meta>;
};

export function modelFileRemovalPaths(fileName: string): string[] {
  return fileName.endsWith('.part')
    ? [fileName.slice(0, -'.part'.length), fileName]
    : [fileName];
}

function registeredModelID(model: unknown): unknown {
  if (model && typeof model === 'object' && 'id' in model) return model.id;
  return undefined;
}

export function removeRegisteredLocalModel<Model, Meta>(
  state: LocalModelRegistryState<Model, Meta>,
  id: string,
): LocalModelRegistryState<Model, Meta> {
  const localModels = state.localModels.filter(
    (model) => registeredModelID(model) !== id,
  );
  const activeLocalModels = { ...state.activeLocalModels };
  for (const task of Object.keys(activeLocalModels) as LocalModelTask[]) {
    if (activeLocalModels[task] === id) delete activeLocalModels[task];
  }
  const { [id]: _, ...savedModelMeta } = state.savedModelMeta;

  return {
    localModels,
    activeLocalModels,
    favoriteLocalModelIds: state.favoriteLocalModelIds.filter((favoriteID) => favoriteID !== id),
    savedModelMeta,
  };
}

export function toggleRegisteredLocalModelFavorite<Model, Meta>(
  state: LocalModelRegistryState<Model, Meta>,
  id: string,
): LocalModelRegistryState<Model, Meta> {
  const favoriteLocalModelIds = state.favoriteLocalModelIds.includes(id)
    ? state.favoriteLocalModelIds.filter((favoriteID) => favoriteID !== id)
    : [...state.favoriteLocalModelIds, id];

  return { ...state, favoriteLocalModelIds };
}
