import { describe, expect, it } from 'vitest';
import { textValueOf, replaceTextValue } from './messageText';

describe('actual Web first text draft operations', () => {
  it('reads and replaces only the first text part preserving metadata and order without mutating the source', () => {
    const parts: any[] = [{ type: 'reasoning', text: 'reason' }, { type: 'text', text: 'first', xFuture: { value: 'raw' } }, { type: 'text', text: 'second' }];
    const before = structuredClone(parts);
    expect(textValueOf(parts)).toBe('first');
    expect(replaceTextValue(parts, 'edited')).toEqual([parts[0], { ...parts[1], text: 'edited' }, parts[2]]);
    expect(parts).toEqual(before);
  });
  it('inserts a text part first only when editing a body without text', () => {
    const parts: any[] = [{ type: 'image_url', image_url: { url: 'FAKE-image', detail: 'auto' }, xFuture: ['kept'] }];
    expect(textValueOf(parts)).toBe('');
    expect(replaceTextValue(parts, 'text')).toEqual([{ type: 'text', text: 'text' }, parts[0]]);
  });
  it('preserves the original UTF8 sequence instead of equating composed and decomposed text', () => {
    const parts = [{ type: 'text' as const, text: '\u00e9' }];
    expect(textValueOf(parts)).not.toBe('e\u0301');
    expect(replaceTextValue(parts, 'e\u0301')[0]).toEqual({ type: 'text', text: 'e\u0301' });
  });
});
