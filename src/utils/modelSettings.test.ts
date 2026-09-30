import { describe, expect, it } from 'vitest';
import { _defaultChatConfig } from '@constants/chat';
import { switchConfigModel } from './modelSettings';

describe('model settings', () => {
  it('keeps generation settings separate by provider and restores them after switching', () => {
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
    expect(sonnet.temperature).toBe(1);
    expect(sonnet.verbosity).toBeUndefined();

    const editedSonnet = { ...sonnet, temperature: 0.7, verbosity: 'low' as const };
    const restored = switchConfigModel(editedSonnet, {
      model: opus.model, providerId: opus.providerId,
    });
    expect(restored.temperature).toBe(0.3);
    expect(restored.verbosity).toBe('max');
    expect(switchConfigModel(restored, {
      model: sonnet.model, providerId: 'openrouter',
    }).verbosity).toBe('low');

    const otherProvider = switchConfigModel(restored, {
      model: opus.model, providerId: 'openai',
    });
    expect(otherProvider.verbosity).toBeUndefined();
  });
});
