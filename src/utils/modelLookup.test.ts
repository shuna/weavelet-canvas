import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNKNOWN_MODEL_CONTEXT_LENGTH,
  UNKNOWN_MODEL_UI_CONTEXT_LENGTH,
} from './tokenBudget';

vi.mock('@store/store', () => ({
  default: {
    getState: vi.fn(),
  },
}));

import useStore from '@store/store';
import {
  getModelConfigContextInfo,
  getModelContextInfo,
  getModelCost,
  getModelSupportsReasoning,
} from './modelLookup';

describe('modelLookup cost units', () => {
  beforeEach(() => {
    vi.mocked(useStore.getState).mockReturnValue({
      providerCustomModels: {},
      favoriteModels: [
        {
          modelId: 'anthropic/claude-opus-4.6',
          providerId: 'openrouter',
          promptPrice: 5,
          completionPrice: 25,
        },
      ],
      providerModelCache: {},
    } as never);
  });

  it('treats prompt and completion prices as per-million-token prices', () => {
    expect(getModelCost('anthropic/claude-opus-4.6', 'openrouter')).toEqual({
      prompt: { price: 5, unit: 1_000_000 },
      completion: { price: 25, unit: 1_000_000 },
      image: { price: null, unit: 1 },
    });
  });

  it('uses favorite model context length when available', () => {
    vi.mocked(useStore.getState).mockReturnValue({
      providerCustomModels: {},
      favoriteModels: [
        {
          modelId: 'anthropic/claude-sonnet-4',
          providerId: 'openrouter',
          contextLength: 200000,
        },
      ],
      providerModelCache: {},
    } as never);

    expect(getModelContextInfo('anthropic/claude-sonnet-4', 'openrouter')).toEqual({
      contextLength: 200000,
      isFallback: false,
    });
  });

  it('uses a conservative fallback context length for unknown models', () => {
    expect(getModelContextInfo('unknown-model', 'openai')).toEqual({
      contextLength: UNKNOWN_MODEL_CONTEXT_LENGTH,
      isFallback: true,
    });
  });

  it('uses a larger fallback context length for config UI on unknown models', () => {
    expect(getModelConfigContextInfo('unknown-model', 'openai')).toEqual({
      contextLength: UNKNOWN_MODEL_UI_CONTEXT_LENGTH,
      isFallback: true,
    });
  });

  it('falls back to heuristic reasoning support for stale favorite metadata', () => {
    vi.mocked(useStore.getState).mockReturnValue({
      providerCustomModels: {},
      favoriteModels: [
        {
          modelId: 'anthropic/claude-opus-4.6',
          providerId: 'openrouter',
          supportsReasoning: false,
        },
      ],
      providerModelCache: {},
    } as never);

    expect(getModelSupportsReasoning('anthropic/claude-opus-4.6', 'openrouter')).toBe(true);
  });

  it('still respects explicit custom-model reasoning overrides', () => {
    vi.mocked(useStore.getState).mockReturnValue({
      providerCustomModels: {
        openrouter: [
          {
            modelId: 'anthropic/claude-opus-4.6',
            providerId: 'openrouter',
            modelType: 'text',
            supportsReasoning: false,
          },
        ],
      },
      favoriteModels: [],
      providerModelCache: {},
    } as never);

    expect(getModelSupportsReasoning('anthropic/claude-opus-4.6', 'openrouter')).toBe(false);
  });
});
