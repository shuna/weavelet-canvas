/**
 * Local model orchestrator — execution-unit level model management.
 *
 * Handles auto-loading, eviction, and sequential/parallel load strategies.
 * Called from submit and evaluation hooks to prepare models before use.
 */

import {
  localModelRuntime,
  findModelDefinition,
  type LocalModelOwnerId,
  type LocalModelReservation,
} from './runtime';
import { estimateDeviceTier, canParallelLoad } from './device';
import type { LocalModelTask } from './types';

// ---------------------------------------------------------------------------
// Store access (lazy to avoid circular imports)
// ---------------------------------------------------------------------------

let _cachedStore: { getState: () => {
  localModelEnabled: boolean;
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
  localModelExecutionMode: 'sequential' | 'parallel-if-possible';
}; } | null = null;

async function getStoreState() {
  if (!_cachedStore) {
    const mod = await import('@store/store');
    _cachedStore = mod.default;
  }
  return _cachedStore!.getState();
}

// ---------------------------------------------------------------------------
// Execution-unit preparation
// ---------------------------------------------------------------------------

/**
 * Prepare all models needed for an execution unit (e.g. generation + evaluation).
 * Handles sequential vs parallel loading based on settings and device tier.
 * After loading, evicts models not in the required set.
 */
let ownerSequence = 0;

export function createLocalModelOwner(scope: string): LocalModelOwnerId {
  ownerSequence += 1;
  return `${scope}:${ownerSequence}`;
}

export async function prepareModelsForExecution(
  ownerId: LocalModelOwnerId,
  requiredModelIds: string[],
): Promise<LocalModelReservation> {
  const ids = [...new Set(requiredModelIds.filter(Boolean))];
  const reservation = localModelRuntime.reserve(ownerId, ids);
  if (ids.length === 0) return reservation;

  try {
    const state = await getStoreState();
    const mode = state.localModelExecutionMode;

    if (mode === 'parallel-if-possible' && ids.length > 1) {
      const sizes = ids.map((id) => {
        const def = findModelDefinition(id);
        return def?.fileSize ?? 0;
      });
      const tier = estimateDeviceTier();

      if (canParallelLoad(sizes, tier)) {
        await Promise.all(ids.map((id) => localModelRuntime.ensureLoaded(id, ownerId)));
      } else {
        for (const id of ids) await localModelRuntime.ensureLoaded(id, ownerId);
      }
    } else {
      for (const id of ids) await localModelRuntime.ensureLoaded(id, ownerId);
    }

    await evictIrrelevantModels(ids);
    return reservation;
  } catch (error) {
    localModelRuntime.release(ownerId);
    throw error;
  }
}

export function releaseModelsForExecution(ownerId: LocalModelOwnerId): void {
  localModelRuntime.release(ownerId);
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

/**
 * Unload models not in the required set.
 * Skips models that are currently busy.
 */
export async function evictIrrelevantModels(
  requiredModelIds: string[],
): Promise<void> {
  const requiredSet = new Set(requiredModelIds);
  const snapshot = localModelRuntime.getSnapshot();

  for (const [modelId, status] of snapshot) {
    if (requiredSet.has(modelId)) continue;
    if (status === 'busy' || status === 'loading') continue;
    if (status === 'ready') {
      try {
        await localModelRuntime.unloadModel(modelId);
      } catch {
        // Best-effort eviction
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Task-level helpers
// ---------------------------------------------------------------------------

/**
 * Get all model IDs needed for evaluation tasks.
 */
export async function getEvaluationModelIds(): Promise<string[]> {
  const state = await getStoreState();
  if (!state.localModelEnabled) return [];

  const ids: string[] = [];
  const analysis = state.activeLocalModels.analysis;
  if (analysis) ids.push(analysis);
  return ids;
}
