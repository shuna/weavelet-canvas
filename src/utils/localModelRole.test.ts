import { describe, expect, it } from 'vitest';
import { localModelRole } from '../../shared/google-sync/localModelRole';

const run = (input: object) => JSON.parse(localModelRole(JSON.stringify(input))) as {changes: {op: string; path: (string | number)[]; value?: unknown}[]};

describe('shared local model role settings', () => {
  const state = {
    localModelEnabled: false,
    activeLocalModels: {generation: 'same-id', quality: '別-model', unknownTask: {opaqueRef: 9}},
    localModels: [{id: 'same-id', bytes: 9007199254740992}],
    savedModelMeta: {'same-id': {storedBytes: 9007199254740992}},
  };

  it('changes only the enable flag, leaving model and metadata out of the delta', () => {
    expect(run({operation: 'enable', state, enabled: true}).changes).toEqual([{op: 'set', path: ['localModelEnabled'], value: true}]);
    expect(run({operation: 'enable', state, enabled: false}).changes).toEqual([]);
  });

  it('uses exact IDs and keeps other task and unknown assignments', () => {
    expect(run({operation: 'assign', state, task: 'generation', modelId: 'same-id'}).changes).toEqual([]);
    expect(run({operation: 'assign', state, task: 'quality', modelId: '別-model-2'}).changes).toEqual([{op: 'set', path: ['activeLocalModels', 'quality'], value: '別-model-2'}]);
    const composed = 'é';
    const decomposed = 'e\u0301';
    expect(run({operation: 'assign', state: {...state, activeLocalModels: {generation: composed}}, task: 'generation', modelId: decomposed}).changes).toEqual([{op: 'set', path: ['activeLocalModels', 'generation'], value: decomposed}]);
  });

  it('removes only the selected task when assigned null', () => {
    const changes = run({operation: 'assign', state, task: 'quality', modelId: null}).changes;
    expect(changes).toEqual(expect.arrayContaining([{op: 'remove', path: ['activeLocalModels', 'quality']}]));
    expect(changes.every(change => change.path[0] === 'activeLocalModels')).toBe(true);
  });
});
