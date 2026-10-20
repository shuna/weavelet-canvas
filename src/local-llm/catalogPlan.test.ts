import { describe, expect, it } from 'vitest';
import { buildHfUrl, catalogDefinition, catalogModels, catalogPlan } from './catalogPlan';

describe('catalog plan', () => {
  it('uses the curated models and their exact download paths', () => {
    expect(catalogModels()).toHaveLength(3);
    const plan = catalogPlan('qwen3-0.6b-q4km');
    expect(plan.files).toEqual([{
      path: 'Qwen_Qwen3-0.6B-Q4_K_M.gguf',
      url: 'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
    }]);
    expect(buildHfUrl(plan.model.huggingFaceRepo, plan.model.revision, plan.model.downloadFiles[0])).toBe(plan.files[0].url);
  });

  it('keeps catalog download definitions aligned with persisted models', () => {
    const { model } = catalogPlan('smollm2-360m-instruct-q8');
    expect(catalogDefinition(model, 123)).toEqual({
      id: model.id, engine: model.engine, tasks: model.tasks, label: model.label,
      origin: model.huggingFaceRepo, source: 'opfs', manifest: model.manifest,
      fileSize: 123, displayMeta: model.displayMeta,
    });
  });

  it('rejects an unknown catalog ID', () => {
    expect(() => catalogPlan('unknown')).toThrow('Unknown catalog model.');
  });
});
