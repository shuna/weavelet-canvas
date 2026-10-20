import type { StoreSlice } from './store';
import type {
  LocalModelDefinition,
  LocalModelTask,
} from '@src/local-llm/types';
import type { SavedModelMeta } from '@src/local-llm/storage';
import { mutateLocalModelRole } from '@utils/localModelRole';
import { commitLocalModel } from '@utils/localModelImport';
import { removeRegisteredLocalModel, toggleRegisteredLocalModelFavorite } from '@utils/localModelRegistry';

export interface LocalModelSlice {
  localModelEnabled: boolean;
  localModels: LocalModelDefinition[];
  /** Task → model ID mapping (which model is active for each task) */
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
  /** OPFS storage metadata keyed by model ID — separate from definitions */
  savedModelMeta: Record<string, SavedModelMeta>;
  /** IDs of local models marked as favorites (shown in chat model selector) */
  favoriteLocalModelIds: string[];
  /** Execution strategy for multi-model scenarios (gen + eval) */
  localModelExecutionMode: 'sequential' | 'parallel-if-possible';

  setLocalModelEnabled: (enabled: boolean) => void;
  addLocalModel: (def: LocalModelDefinition) => void;
  removeLocalModel: (id: string) => void;
  updateLocalModel: (id: string, patch: Partial<LocalModelDefinition>) => void;
  setActiveLocalModel: (task: LocalModelTask, modelId: string | null) => void;
  updateSavedModelMeta: (id: string, patch: Partial<SavedModelMeta>) => void;
  removeSavedModelMeta: (id: string) => void;
  toggleFavoriteLocalModel: (id: string) => void;
  setLocalModelExecutionMode: (mode: 'sequential' | 'parallel-if-possible') => void;
}

export const createLocalModelSlice: StoreSlice<LocalModelSlice> = (set, get) => ({
  localModelEnabled: false,
  localModels: [],
  activeLocalModels: {},
  savedModelMeta: {},
  favoriteLocalModelIds: [],
  localModelExecutionMode: 'sequential',

  setLocalModelEnabled: (enabled) => {
    set((prev) => ({ localModelEnabled: mutateLocalModelRole(prev, {operation: 'enable', enabled}).localModelEnabled }));
  },

  addLocalModel: (def) => {
    const current = get();
    const next = commitLocalModel(current, def);
    if (next.localModels !== current.localModels) set({ localModels: next.localModels });
  },

  removeLocalModel: (id) => {
    set((state) => removeRegisteredLocalModel({
      localModels: state.localModels,
      activeLocalModels: state.activeLocalModels,
      favoriteLocalModelIds: state.favoriteLocalModelIds,
      savedModelMeta: state.savedModelMeta,
    }, id));
  },

  updateLocalModel: (id, patch) => {
    const models = get().localModels.map((m) =>
      m.id === id ? { ...m, ...patch } : m,
    );
    set({ localModels: models });
  },

  setActiveLocalModel: (task, modelId) => {
    set((prev) => ({ activeLocalModels: mutateLocalModelRole(prev, {operation: 'assign', task, modelId}).activeLocalModels }));
  },

  updateSavedModelMeta: (id, patch) => {
    const current = get().savedModelMeta;
    const existing = current[id] ?? {
      storageState: 'none',
      storedBytes: 0,
      storedFiles: [],
    };
    set({
      savedModelMeta: {
        ...current,
        [id]: { ...existing, ...patch },
      },
    });
  },

  removeSavedModelMeta: (id) => {
    const { [id]: _, ...rest } = get().savedModelMeta;
    set({ savedModelMeta: rest });
  },

  toggleFavoriteLocalModel: (id) => {
    set((state) => ({
      favoriteLocalModelIds: toggleRegisteredLocalModelFavorite({
        localModels: state.localModels,
        activeLocalModels: state.activeLocalModels,
        favoriteLocalModelIds: state.favoriteLocalModelIds,
        savedModelMeta: state.savedModelMeta,
      }, id).favoriteLocalModelIds,
    }));
  },

  setLocalModelExecutionMode: (mode) => {
    set({ localModelExecutionMode: mode });
  },
});
