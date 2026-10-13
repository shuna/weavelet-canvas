import {describe, expect, it} from 'vitest';
import {applyPromptLibraryAction, parsePromptLibraryCSV, promptsToCSV} from './promptLibrary';

describe('prompt library Web operations', () => {
  it('edits labels without changing unrelated fields or prompt order', () => {
    const source = [{id: 'a', name: 'A', prompt: 'one', extra: {keep: true}}, {id: 'b', name: 'B', prompt: 'two'}] as any;
    const labeled = applyPromptLibraryAction(source, {type: 'edit', index: 0, field: 'label', value: 'system'});
    expect(labeled[0]).toEqual({...source[0], label: 'system'});
    expect(labeled[1]).toBe(source[1]);
    expect(applyPromptLibraryAction(labeled, {type: 'edit', index: 0, field: 'label', value: null})[0]).toEqual(source[0]);
    expect(applyPromptLibraryAction(labeled, {type: 'remove', index: 0})).toEqual([source[1]]);
    expect(applyPromptLibraryAction(source, {type: 'clear'})).toEqual([]);
  });

  it('round trips quoted CSV and imports first two columns with append or replace and new IDs', () => {
    const source = [{id: 'old', name: 'A,"B"', prompt: 'line 1\nline 2', label: 'user' as const}];
    const rows = parsePromptLibraryCSV(promptsToCSV(source));
    expect(rows).toEqual([{name: source[0].name, prompt: source[0].prompt}]);
    expect(applyPromptLibraryAction(source, {type: 'import', mode: 'append', rows, newIDs: ['new']}))
      .toEqual([...source, {id: 'new', ...rows[0]}]);
    expect(applyPromptLibraryAction(source, {type: 'import', mode: 'replace', rows, newIDs: ['new']}))
      .toEqual([{id: 'new', ...rows[0]}]);
    expect(parsePromptLibraryCSV('first,second,third\na,b,c')).toEqual([{name: 'a', prompt: 'b'}]);
  });
});
