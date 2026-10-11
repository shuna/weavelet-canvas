import { useEffect } from 'react';
import useStore from '@store/store';
import { CURATED_MODELS } from '@src/local-llm/catalog';
import { rehydrateSavedModels } from '@src/local-llm/storage';
import { localModelRehydrationGeneration } from '@src/local-llm/rehydrationState';

let initialRehydration: Promise<void> | null = null;

export async function rehydrateLocalModels(refresh = false): Promise<void> {
  if (!refresh && initialRehydration) return initialRehydration;
  const run = async () => {
    if (!useStore.getState().localModelEnabled) return;
    const generation = localModelRehydrationGeneration();
    const searchModels = useStore.getState().localModels
      .filter((model) => model.source === 'opfs' && !CURATED_MODELS.some((catalog) => catalog.id === model.id))
      .map((model) => ({ id: model.id, manifest: model.manifest }));
    const meta = await rehydrateSavedModels([...CURATED_MODELS, ...searchModels]);
    if (generation !== localModelRehydrationGeneration()) return;
    for (const [id, saved] of Object.entries(meta)) {
      if (generation !== localModelRehydrationGeneration()) return;
      const store = useStore.getState();
      store.updateSavedModelMeta(id, saved);
      if (saved.storageState !== 'saved' || useStore.getState().localModels.some((model) => model.id === id)) continue;
      const catalog = CURATED_MODELS.find((model) => model.id === id);
      if (catalog) {
        store.addLocalModel({
          id: catalog.id, engine: catalog.engine, tasks: catalog.tasks,
          label: catalog.label, origin: catalog.huggingFaceRepo, source: 'opfs',
          manifest: catalog.manifest, fileSize: saved.storedBytes || catalog.expectedDownloadSize,
          displayMeta: catalog.displayMeta,
        });
      }
    }
  };
  if (refresh) return run();
  initialRehydration = run();
  return initialRehydration;
}

export default function useLocalModelRehydration(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void rehydrateLocalModels().catch(() => {});
  }, [enabled]);
}
