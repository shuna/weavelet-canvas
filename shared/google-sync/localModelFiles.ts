import { getManifestFiles, getManifestPrimaryFile } from '../../src/local-llm/ggufShardUtils';
import { getFinalModelFiles, hasRequiredModelParts } from '../../src/local-llm/fileProvider';
import type { LocalModelDefinition } from '../../src/local-llm/types';

export function localModelFiles(json: string): string {
  const { model, files = [] } = JSON.parse(json) as { model: LocalModelDefinition; files?: string[] };
  const supported = (model.engine === 'transformers.js' && model.manifest?.kind === 'multi-file')
    || (model.engine === 'wllama' && model.manifest?.kind === 'gguf-sharded');
  if (typeof model.id !== 'string' || !model.id.trim() || !supported) {
    throw new Error('Select a supported multi-file model');
  }
  const requiredFiles = getManifestFiles(model.manifest);
  const entrypoint = getManifestPrimaryFile(model.manifest);
  if (!Array.isArray(requiredFiles) || !requiredFiles.length || requiredFiles.some((path) => typeof path !== 'string') || typeof entrypoint !== 'string' || !requiredFiles.includes(entrypoint)) {
    throw new Error('Invalid multi-file manifest');
  }
  if (hasRequiredModelParts(requiredFiles, files)) throw new Error('Required model file download is incomplete');
  return JSON.stringify({ id: model.id, requiredFiles, entrypoint, files: getFinalModelFiles(files) });
}
