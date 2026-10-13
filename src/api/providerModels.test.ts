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

describe('fetchProviderModels failure versus empty result', () => {
  const provider: ProviderConfig = {id:'openrouter',name:'fake',endpoint:'https://example.test/chat',modelsEndpoint:'https://example.test/models',modelsRequireAuth:false};
  it('does not treat an unavailable endpoint or missing required key as a fetched empty list', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
    await expect(fetchProviderModels({...provider,modelsEndpoint:undefined})).resolves.toBeNull();
    await expect(fetchProviderModels({...provider,modelsRequireAuth:true})).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it('throws for HTTP, network, and JSON failures', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ok:false,status:503})
      .mockRejectedValueOnce(new Error('fake network failure'))
      .mockResolvedValueOnce({ok:true,json:()=>Promise.reject(new Error('fake JSON failure'))});
    vi.stubGlobal('fetch',fetch);
    await expect(fetchProviderModels(provider)).rejects.toThrow('HTTP 503');
    await expect(fetchProviderModels(provider)).rejects.toThrow('network');
    await expect(fetchProviderModels(provider)).rejects.toThrow('JSON');
    vi.unstubAllGlobals();
  });
  it('returns an empty array for a successful empty response', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({data:[]})}));
    await expect(fetchProviderModels(provider)).resolves.toEqual([]); vi.unstubAllGlobals();
  });
});
