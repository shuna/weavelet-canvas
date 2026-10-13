import {afterEach, describe, expect, it, vi} from 'vitest';
import {wordDiff} from './diffUtils';

afterEach(() => vi.restoreAllMocks());

function preservesBoth(a: string, b: string) {
  const segments = wordDiff(a, b);
  expect(segments.filter(segment => segment.type !== 'added').map(segment => segment.text).join('')).toBe(a);
  expect(segments.filter(segment => segment.type !== 'removed').map(segment => segment.text).join('')).toBe(b);
  return segments;
}

describe('shared word diff', () => {
  it('keeps word boundaries, whitespace, quotes, Unicode and empty text', () => {
    expect(preservesBoth('before \n 😀 日本語', 'after \n 😀 日本語')).toEqual([
      {type:'removed',text:'before'}, {type:'added',text:'after'}, {type:'equal',text:' \n 😀 日本語'},
    ]);
    preservesBoth('"a"\t\n é', '"b"\r\n e\u0301');
    preservesBoth('', '');
    preservesBoth('', 'value');
    preservesBoth('value', '');
    preservesBoth('x  y', 'x y');
  });

  it('restores every token after both dictionary limits coalesce the remainder', () => {
    const a = Array.from({length:40020}, (_, index) => `a-${index}`).join(' ');
    const b = Array.from({length:26000}, (_, index) => `b-${index}`).join('\t');
    preservesBoth(a, b);
  });

  it('preserves both inputs when the positive library deadline expires', () => {
    let time = 0;
    const clock = vi.spyOn(Date.prototype, 'getTime').mockImplementation(() => time += 2000);
    const a = Array.from({length:1000}, (_, index) => `left-${index}`).join(' ');
    const b = Array.from({length:1000}, (_, index) => `right-${index}`).join(' ');
    preservesBoth(a, b);
    expect(clock.mock.calls.length).toBeGreaterThan(1);
  });
});
