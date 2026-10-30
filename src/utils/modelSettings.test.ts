import { describe, expect, it, vi } from 'vitest';
import { _defaultChatConfig } from '@constants/chat';
import useStore from '@store/store';
import { switchConfigModel } from './modelSettings';

describe('model settings', () => {
  it('keeps only the active configuration and uses common defaults on explicit model switches', () => {
    vi.spyOn(useStore, 'getState').mockReturnValue({
      providerCustomModels: {}, favoriteModels: [],
      providerModelCache: { openrouter: [{
        id: 'anthropic/claude-sonnet-4', contextLength: 200000, maxCompletionTokens: 64000,
      }] },
    } as never);
    const opus = {
      ..._defaultChatConfig,
      model: 'anthropic/claude-opus-4.6',
      providerId: 'openrouter' as const,
      temperature: 0.3,
      verbosity: 'max' as const,
    };
    const sonnet = switchConfigModel(opus, {
      model: 'anthropic/claude-sonnet-4', providerId: 'openrouter',
    });
    expect(sonnet.max_tokens).toBe(64000);
    expect(sonnet.temperature).toBe(1);
    expect(sonnet.verbosity).toBeUndefined();

    const editedSonnet = { ...sonnet, max_tokens: 12000, temperature: 0.7, verbosity: 'low' as const };
    const restored = switchConfigModel(editedSonnet, {
      model: opus.model, providerId: opus.providerId,
    });
    expect(restored.temperature).toBe(1);
    expect(restored.modelSettings).toBeUndefined();
    expect(restored.verbosity).toBeUndefined();
    expect(switchConfigModel(restored, {
      model: sonnet.model, providerId: 'openrouter',
    }).max_tokens).toBe(64000);
    expect(switchConfigModel(restored, {
      model: sonnet.model, providerId: 'openrouter',
    }).verbosity).toBeUndefined();

    const otherProvider = switchConfigModel(restored, {
      model: opus.model, providerId: 'openai',
    });
    expect(otherProvider.verbosity).toBeUndefined();
  });
});

it('preserves a current model and its explicit settings when common metadata changes', () => {
  const config = { ..._defaultChatConfig, model: 'same', providerId: 'lan' as const, max_tokens: 1234, temperature: 0.2, modelReview: 'previous' };
  expect(switchConfigModel(config, { model: 'same', providerId: 'lan', modelSource: 'remote' })).toBe(config);
});

it('changes the common revision without rewriting the chat configuration', async () => {
  const { commonModelRevision, commonModelSettings } = await import('./modelSettings');
  const state = { defaultChatConfig: { ..._defaultChatConfig, temperature: 0.6 }, providerCustomModels: { lan: [{ modelId: 'model', providerId: 'lan', modelType: 'text', contextLength: 8192 }] }, favoriteModels: [], providerModelCache: {} };
  vi.spyOn(useStore, 'getState').mockReturnValue(state as never);
  const config = Object.freeze({ ..._defaultChatConfig, model: 'model', providerId: 'lan' as const, temperature: 0.2, max_tokens: 1234 });
  const revision = commonModelRevision(config);
  state.providerCustomModels.lan[0].contextLength = 65536;
  expect(commonModelRevision(config)).not.toBe(revision);
  expect(config.max_tokens).toBe(1234); expect(config.temperature).toBe(0.2);
  expect(commonModelSettings(config).temperature).toBe(0.6);
  expect(commonModelSettings(config).max_tokens).toBeGreaterThan(1234);
});
