import {describe, expect, it} from 'vitest';
import {evaluation} from '../../shared/google-sync/evaluation';
import {localAxisPrompt} from './localEvaluationCore';

const encodedForWllama = (value: string) => new TextDecoder().decode(new TextEncoder().encode(value));

describe('localPrompt bridge', () => {
  it('returns the exact text Wllama encodes after UTF-16 truncation', () => {
    expect(localAxisPrompt('taskCompletion', 'x'.repeat(399) + '😀', undefined, 'en').prompt).toContain('x'.repeat(399) + '\ud83d');
    expect(localAxisPrompt('taskCompletion', 'x'.repeat(149) + '😀', undefined, 'en').fallback).toContain('x'.repeat(149) + '\ud83d');
    for (const text of [
      'x'.repeat(399) + '😀',
      'x'.repeat(149) + '😀',
      'valid 😀 and 𠀀 non-BMP',
      'lone high \ud83d and lone low \ude00',
    ]) {
      const original = localAxisPrompt('taskCompletion', text, 'answer \ude00', 'en');
      const bridged = JSON.parse(evaluation(JSON.stringify({operation:'localPrompt',axis:'taskCompletion',text,assistantResponse:'answer \ude00',language:'en'})));
      expect(bridged.prompt).toBe(encodedForWllama(original.prompt));
      expect(bridged.fallback).toBe(encodedForWllama(original.fallback));
      expect(bridged.options).toEqual(original.options);
      expect(bridged.fallbackOptions).toEqual(original.fallbackOptions);
    }
  });
});
