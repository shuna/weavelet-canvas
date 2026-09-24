import { describe, it, expect, vi } from 'vitest';
import { fetchProviderModels, isReasoningModel } from './providerModels';
import type { ProviderConfig } from '@type/provider';

describe('isReasoningModel', () => {
  // Should match
  const positives = [
    'o1',
    'o1-mini',
    'o1-preview',
    'o3',
    'o3-mini',
    'o4-mini',
    'openai/o1-mini',
    'openai/o3-mini',
    'deepseek-r1',
    'deepseek-r1-distill-qwen-32b',
    'deepseek-reasoner',
    'qwq-32b',
    'qwq-32b-preview',
    'anthropic/claude-3.5-sonnet:thinking',
    'claude-3-opus-thinking',
    'anthropic/claude-opus-4.6',
    'anthropic/claude-sonnet-4',
    'anthropic/claude-4.6-sonnet',
    'anthropic/claude-opus-4.5',
    'claude-3.7-sonnet',
  ];

  // Should NOT match
  const negatives = [
    'gpt-4o',
    'gpt-4o-mini',
    'falcon-40b-instruct',
    'photo1-model',
    'proto1-v2',
    'polaris-model',
    'llama-3-70b',
    'claude-3.5-sonnet',
    'gemini-pro',
    'mistral-large',
    'command-r-plus',
  ];

  for (const id of positives) {
    it(`matches reasoning model: ${id}`, () => {
      expect(isReasoningModel(id)).toBe(true);
    });
  }

  for (const id of negatives) {
    it(`rejects non-reasoning model: ${id}`, () => {
      expect(isReasoningModel(id)).toBe(false);
    });
  }
});

describe('fetchProviderModels', () => {
  it('preserves OpenRouter mandatory reasoning metadata', async () => {
    const response = {
      data: [{
        id: 'anthropic/claude-opus-5.5',
        name: 'Claude Opus 5.5',
        supported_parameters: ['reasoning'],
        reasoning: { mandatory: true },
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    }));

    const provider: ProviderConfig = {
      id: 'openrouter',
      name: 'OpenRouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      modelsEndpoint: 'https://openrouter.ai/api/v1/models',
      modelsRequireAuth: false,
    };

    await expect(fetchProviderModels(provider)).resolves.toMatchObject([
      { id: 'anthropic/claude-opus-5.5', reasoningMandatory: true },
    ]);
    vi.unstubAllGlobals();
  });
});
