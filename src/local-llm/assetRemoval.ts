/** Main-thread coordination for deleting local-model assets.
 * Kept outside storage because storage is imported by Worker bundles. */
import { localModelRuntime } from './runtime';
import {
  beginAssetRemoval, endAssetRemoval, removeStoredAssets, stopModelWriters,
  type RemoveAssetsResult,
} from './storage';
import { invalidateLocalModelRehydration } from './rehydrationState';
import type { LocalModelManifest } from './types';

export async function removeAssets(
  modelId: string,
  scope: { files?: string[]; manifest?: LocalModelManifest } = {},
): Promise<RemoveAssetsResult> {
  if (!beginAssetRemoval(modelId)) {
    return { status: 'blocked', removedFiles: [], retainedFiles: [], verification: 'none' };
  }
  invalidateLocalModelRehydration();
  try {
    const stopped = await localModelRuntime.stopForAssetRemoval(modelId);
    if (stopped === 'blocked' || !(await stopModelWriters(modelId))) {
      return { status: 'blocked', removedFiles: [], retainedFiles: [], verification: 'partial' };
    }
    return await removeStoredAssets(modelId, scope);
  } finally {
    localModelRuntime.endAssetRemoval(modelId);
    endAssetRemoval(modelId);
  }
}
