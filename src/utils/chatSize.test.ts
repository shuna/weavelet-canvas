import { describe, expect, it } from 'vitest';
import { isImageContent, isTextContent, type ContentInterface } from '@type/chat';
import { chatSizeFromLengths, chatSizeLabel, formatNumber, measureChatSize } from './chatSize';
import { formatNumber as existingFormatNumber } from './chat';

// Exact reduction previously used by all three actual ChatHistoryList paths.
const originalWebSize = (messages: { content: ContentInterface[] }[]) => messages.reduce((prev, current) => prev +
  current.content.reduce((prevInner, part) => prevInner + (isTextContent(part) ? part.text.length :
    isImageContent(part) ? part.image_url.url.length : 0), 0), 0);

describe('actual Web sidebar chat size', () => {
  it('counts UTF-16 text and image URL lengths while excluding normal reasoning and tools', () => {
    const messages: { content: ContentInterface[] }[] = [{ content: [
      { type: 'text', text: '😀e\u0301' },
      { type: 'image_url', image_url: { url: 'data', detail: 'auto' } },
      { type: 'reasoning', text: 'not counted' },
      { type: 'tool_call', id: 'call', name: 'name', arguments: 'not counted' },
      { type: 'tool_result', tool_call_id: 'call', content: 'not counted' },
    ] }];
    expect(originalWebSize(messages)).toBe(8);
    expect(measureChatSize(messages)).toBe(originalWebSize(messages));
    expect(measureChatSize([])).toBe(0);
  });
  it('preserves text precedence and the actual image_url presence guard for extra attributes', () => {
    const text = { type: 'text' as const, text: 'abc', image_url: { url: 'ignore URL', detail: 'auto' as const }, raw: { retained: 1 } };
    const reasoning = { type: 'reasoning' as const, text: 'ignored', image_url: { url: '😀', detail: 'auto' as const } };
    const tool = { type: 'tool_result' as const, tool_call_id: 'call', content: 'ignored', image_url: { url: '123', detail: 'auto' as const } };
    const messages = [{ content: [text, reasoning, tool, { type: 'reasoning' as const, text: 'no image', image_url: undefined }] }];
    const before = structuredClone(messages);
    expect(originalWebSize(messages)).toBe(8);
    expect(measureChatSize(messages)).toBe(originalWebSize(messages));
    expect(messages).toEqual(before);
    expect(chatSizeFromLengths([[{ type: 'reasoning', textLength: 100, hasImageURL: false, imageURLLength: 10 }]])).toBe(0);
  });
  it('shares the unchanged existing formatter and omits zero sizes', () => {
    expect(existingFormatNumber).toBe(formatNumber);
    expect(formatNumber(1234567)).toBe('1 234 567');
    expect(chatSizeLabel(1234)).toBe('1 234');
    expect(chatSizeLabel(0)).toBeUndefined();
  });
});
