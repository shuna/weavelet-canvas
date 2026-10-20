import { CURATED_MODELS, type CatalogModel } from './catalog';
import type { LocalModelDefinition } from './types';

export function buildHfUrl(repo: string, revision: string, filePath: string): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${repo}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
}

export function catalogModels(): CatalogModel[] {
  return CURATED_MODELS;
}

export function catalogPlan(id: string): { model: CatalogModel; files: { path: string; url: string }[] } {
  const model = catalogModels().find((candidate) => candidate.id === id);
  if (!model) throw new Error('Unknown catalog model.');
  return {
    model,
    files: model.downloadFiles.map((path) => ({
      path,
      url: buildHfUrl(model.huggingFaceRepo, model.revision, path),
    })),
  };
}

export function catalogDefinition(model: CatalogModel, totalBytes: number): LocalModelDefinition {
  return {
    id: model.id,
    engine: model.engine,
    tasks: model.tasks,
    label: model.label,
    origin: model.huggingFaceRepo,
    source: 'opfs',
    manifest: model.manifest,
    fileSize: totalBytes,
    displayMeta: model.displayMeta,
  };
}
