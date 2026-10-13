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
  ])('appends to first text content without a separator: $expected', ({ previous, text, expected }) => {
    expect(appendCommandLibraryPrompt(previous, text)).toEqual([{ type: 'text', text: expected }]);
  });

  it('appends to first text content while preserving its metadata and every remaining part exactly', () => {
    const first: TextContentInterface & { metadata: { label: string } } = {
      type: 'text', text: 'first', metadata: { label: 'first metadata' },
    };
    const second = { type: 'text' as const, text: 'second', metadata: { label: 'remaining metadata' } };
    const image = { type: 'image_url' as const, image_url: { url: 'remaining-image', detail: 'auto' as const }, metadata: ['kept'] };
    const previous = [first, second, image];
    const before = structuredClone(previous);
    const result = appendCommandLibraryPrompt(previous, 'prompt');
    expect(result).toEqual([{ ...first, text: 'firstprompt' }, second, image]);
    expect((result[0] as typeof first).metadata).toBe(first.metadata);
    expect(result[1]).toBe(second);
    expect(result[2]).toBe(image);
    expect(previous).toEqual(before);
  });

  it('prepends text for the cloned image-only content received by message editing', () => {
    const original = [{ type: 'image_url' as const, image_url: { url: 'imported-image', detail: 'high' as const }, metadata: { label: 'image metadata' } }];
    const editingContent = structuredClone(original);
    const before = structuredClone(editingContent);
    const result = appendCommandLibraryPrompt(editingContent, 'prompt');
    expect(result).toEqual([{ type: 'text', text: 'prompt' }, ...original]);
    expect(result[1]).toBe(editingContent[0]);
    expect(editingContent).toEqual(before);
  });

  it.each<ContentInterface>([
    { type: 'image_url', image_url: { url: 'first-image', detail: 'auto' } },
    { type: 'reasoning', text: 'reason' },
    { type: 'tool_result', tool_call_id: 'call', content: 'result' },
  ])('prepends text without changing a $type first part or appending to later text', (first) => {
    const laterText = { type: 'text' as const, text: 'later text', metadata: { retained: true } };
    const previous = [first, laterText];
    const before = structuredClone(previous);
    const result = appendCommandLibraryPrompt(previous, 'prompt');
    expect(result).toEqual([{ type: 'text', text: 'prompt' }, first, laterText]);
    expect(result[1]).toBe(first);
    expect(result[2]).toBe(laterText);
    expect(previous).toEqual(before);
  });
});
