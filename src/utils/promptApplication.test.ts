import { describe, expect, it } from 'vitest';
import type { ContentInterface, TextContentInterface } from '@type/chat';
import { appendCommandLibraryPrompt, appendSystemLibraryPrompt } from './promptApplication';

describe('system prompt library insertion from SystemPromptField.onInsert', () => {
  it.each([
    ['', 'prompt', 'prompt'],
    ['existing', 'prompt', 'existing\n\nprompt'],
    [' ', 'prompt', ' \n\nprompt'],
    ['\n', 'prompt', '\n\n\nprompt'],
    ['', '', ''],
    ['existing', '', 'existing\n\n'],
    ['existing\n', ' prompt ', 'existing\n\n\n prompt '],
  ])('keeps the original truthy-previous separator: %j + %j', (previous, text, expected) => {
    expect(appendSystemLibraryPrompt(previous, text)).toBe(expected);
  });
});

describe('command prompt insertion from CommandPrompt application callback', () => {
  it.each<{ previous: ContentInterface[]; text: string; expected: string }>([
    { previous: [], text: 'prompt', expected: 'prompt' },
    { previous: [], text: '', expected: '' },
    { previous: [{ type: 'text', text: '' }], text: 'prompt', expected: 'prompt' },
    { previous: [{ type: 'text', text: 'existing' }], text: 'prompt', expected: 'existingprompt' },
    { previous: [{ type: 'text', text: ' \n' }], text: ' prompt ', expected: ' \n prompt ' },
    { previous: [{ type: 'text', text: 'existing' }], text: '', expected: 'existing' },
    { previous: [{ type: 'reasoning', text: 'reason' }], text: 'prompt', expected: 'reasonprompt' },
    { previous: [{ type: 'image_url', image_url: { url: 'first-image', detail: 'auto' } }], text: 'prompt', expected: 'prompt' },
  ])('uses the first .text when defined without a separator: $expected', ({ previous, text, expected }) => {
    expect(appendCommandLibraryPrompt(previous, text)).toEqual([{ type: 'text', text: expected }]);
  });

  it('reconstructs the first part, dropping its extra attributes, and preserves every remaining part exactly', () => {
    const first: TextContentInterface & { metadata: { label: string } } = {
      type: 'text', text: 'first', metadata: { label: 'first metadata' },
    };
    const second = { type: 'text' as const, text: 'second', metadata: { label: 'remaining metadata' } };
    const image = { type: 'image_url' as const, image_url: { url: 'remaining-image', detail: 'auto' as const }, metadata: ['kept'] };
    const previous = [first, second, image];
    const before = structuredClone(previous);
    const result = appendCommandLibraryPrompt(previous, 'prompt');
    expect(result).toEqual([{ type: 'text', text: 'firstprompt' }, second, image]);
    expect(result[1]).toBe(second);
    expect(result[2]).toBe(image);
    expect(previous).toEqual(before);
  });

  it('replaces a non-text first part rather than inserting before it or appending to a later text part', () => {
    const laterText = { type: 'text' as const, text: 'later text', metadata: { retained: true } };
    const previous: ContentInterface[] = [{ type: 'tool_result', tool_call_id: 'call', content: 'result' }, laterText];
    expect(appendCommandLibraryPrompt(previous, 'prompt')).toEqual([{ type: 'text', text: 'prompt' }, laterText]);
  });
});
