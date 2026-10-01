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
import { normalizeConfigStream } from './streamSupport';
import { _defaultChatConfig } from '@constants/chat';
import {
  getModelDefaultMaxTokens,
  getModelConfigContextInfo,
  getModelContextInfo,
  getModelCost,
  getModelRequiresReasoning,
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

  it('reads mandatory reasoning from provider metadata', () => {
    vi.mocked(useStore.getState).mockReturnValue({
      providerCustomModels: {},
      favoriteModels: [],
      providerModelCache: {
        openrouter: [{
          id: 'anthropic/claude-opus-5.5',
          name: 'Claude Opus 5.5',
          providerId: 'openrouter',
          reasoningMandatory: true,
        }],
      },
    } as never);

    expect(getModelRequiresReasoning('anthropic/claude-opus-5.5', 'openrouter')).toBe(true);
  });

  it('recognizes Opus 5.5 before provider metadata is refreshed', () => {
    expect(getModelRequiresReasoning('anthropic/claude-opus-5.5', 'openrouter')).toBe(true);
    expect(getModelRequiresReasoning('anthropic/claude-opus-5', 'openrouter')).toBe(false);
  });
});

describe('model completion defaults', () => {
  it('prefers output limits, then known context budgets, then 4000', () => {
    vi.mocked(useStore.getState).mockReturnValue({
      providerCustomModels: {},
      favoriteModels: [],
      providerModelCache: { openrouter: [
        { id: 'output', contextLength: 200000, maxCompletionTokens: 32000 },
        { id: 'context', contextLength: 10000 },
        { id: 'small', contextLength: 2000, maxCompletionTokens: 4000 },
        { id: 'invalid', maxCompletionTokens: -1 },
        { id: 'output-only', maxCompletionTokens: 16000 },
      ] },
    } as never);
    expect(getModelDefaultMaxTokens('output', 'openrouter')).toBe(32000);
    expect(getModelDefaultMaxTokens('context', 'openrouter')).toBe(9000);
    expect(getModelDefaultMaxTokens('small', 'openrouter')).toBe(1800);
    expect(getModelDefaultMaxTokens('unknown', 'openrouter')).toBe(4000);
    expect(getModelDefaultMaxTokens('invalid', 'openrouter')).toBe(4000);
    expect(getModelDefaultMaxTokens('output-only', 'openrouter')).toBe(16000);
    const config = { ..._defaultChatConfig, model: 'output', providerId: 'openrouter' as const };
    expect(normalizeConfigStream(config).max_tokens).toBe(32000);
    expect(normalizeConfigStream({ ...config, max_tokens: 1000 }).max_tokens).toBe(1000);
    expect(normalizeConfigStream({ ...config, max_tokens: 0 }).max_tokens).toBe(0);
  });
});
