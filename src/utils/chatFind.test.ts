import { describe, expect, it } from 'vitest';
import { findTextMatches } from './chatFind';

describe('chat find source ranges', () => {
  it('keeps overlapping literal matches, casing, whitespace and UTF-16 offsets', () => {
    expect(findTextMatches('banana', 'ANA')).toEqual([{ start: 1, end: 4 }, { start: 3, end: 6 }]);
    expect(findTextMatches('😀 A.* a.*', 'a.*')).toEqual([{ start: 3, end: 6 }, { start: 7, end: 10 }]);
    expect(findTextMatches(' a a ', ' a ')).toEqual([{ start: 0, end: 3 }, { start: 2, end: 5 }]);
    expect(findTextMatches('anything', ' \t ')).toEqual([]);
    expect(findTextMatches('é', 'e\u0301')).toEqual([]);
  });
  it('maps expanded lowercase characters back without shifting or losing text', () => {
    expect(findTextMatches('İxİ', 'i')).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }]);
    expect(findTextMatches('İxİ', 'İ')).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }]);
    expect(findTextMatches('İx', 'x')).toEqual([{ start: 1, end: 2 }]);
    expect(findTextMatches('İx', '\u0307x')).toEqual([{ start: 0, end: 2 }]);
    expect(findTextMatches('ΟΣ', 'ος')).toEqual([{ start: 0, end: 2 }]);
  });
});
