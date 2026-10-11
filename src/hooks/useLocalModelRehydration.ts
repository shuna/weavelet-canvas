import { useEffect } from 'react';
import useStore from '@store/store';
import { CURATED_MODELS } from '@src/local-llm/catalog';
import { rehydrateSavedModels } from '@src/local-llm/storage';

let initialRehydration: Promise<void> | null = null;

export async function rehydrateLocalModels(refresh = false): Promise<void> {
  if (!refresh && initialRehydration) return initialRehydration;
  const run = async () => {
    const searchModels = useStore.getState().localModels
      .filter((model) => model.source === 'opfs' && !CURATED_MODELS.some((catalog) => catalog.id === model.id))
      .map((model) => ({ id: model.id, manifest: model.manifest }));
    const meta = await rehydrateSavedModels([...CURATED_MODELS, ...searchModels]);
    const store = useStore.getState();
    for (const [id, saved] of Object.entries(meta)) {
      store.updateSavedModelMeta(id, saved);
      if (saved.storageState !== 'saved' || store.localModels.some((model) => model.id === id)) continue;
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
