import {diff_match_patch} from 'diff-match-patch';

export interface DiffSegment {
  type: 'equal' | 'added' | 'removed';
  text: string;
}

export function wordDiff(a: string, b: string): DiffSegment[] {
  const dmp = new diff_match_patch();
  // shortcut: caps/deadline group words; revisit mapping if finer large-input highlighting is required.
  const encode = (text: string) => text.split(/(\s+)/).map(token => JSON.stringify(token) + '\n').join('');
  const {chars1, chars2, lineArray} = dmp.diff_linesToChars_(encode(a), encode(b));
  const diffs = dmp.diff_main(chars1, chars2, false);
  dmp.diff_charsToLines_(diffs, lineArray);
  return diffs.map(([operation, encoded]) => ({
    type: operation === 0 ? 'equal' : operation === 1 ? 'added' : 'removed',
    // A capped dictionary entry may contain many JSON lines; restore them all.
    text: encoded.split('\n').slice(0, -1).map(line => JSON.parse(line) as string).join(''),
  }));
}
