export type TextMatch = { start: number; end: number };

export function findTextMatches(text: string, query: string): TextMatch[] {
  if (!query.trim()) return [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  // Lowercasing can expand a character (İ → i + combining dot); map back to the original text.
  for (const character of text) {
    const length = character.toLowerCase().length;
    for (let unit = 0; unit < length; unit++) {
      starts.push(offset + (length === character.length ? unit : 0));
      ends.push(offset + (length === character.length ? unit + 1 : character.length));
    }
    offset += character.length;
  }
  const matches: TextMatch[] = [];
  for (let index = lower.indexOf(needle); index !== -1; index = lower.indexOf(needle, index + 1)) {
    matches.push({ start: starts[index], end: ends[index + needle.length - 1] });
  }
  return matches;
}
