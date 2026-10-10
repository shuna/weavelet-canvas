import { expect, it } from 'vitest';
import { digest } from './crypto';
import { replayHistory, type Commit } from './replay';

const commit = async (parents: string[], before: string | null, after: string | null, resolutions?: Commit['resolutions']): Promise<Commit> => ({
  version: 1, parents, changes: [{ key: 'key', before: before === null ? null : await digest(before), after }], resolutions,
});

it('keeps the former replay results for linear, branched, merged, deleted, equal and resolved histories', async () => {
  const base = await commit([], null, 'one');
  const linear = await commit(['base'], 'one', 'two');
  const deleted = await commit(['linear'], 'two', null);
  expect(await replayHistory({ commits: { base, linear, deleted }, tips: ['deleted'] })).toEqual({ records: {}, conflicts: {} });

  const left = await commit(['base'], 'one', 'left');
  const right = await commit(['base'], 'one', 'right');
  expect(await replayHistory({ commits: { base, left, right }, tips: ['left', 'right'] })).toEqual({
    records: { key: 'left' }, conflicts: { key: [await digest('left'), await digest('right')] },
  });

  const same = await commit(['base'], 'one', 'left');
  expect(await replayHistory({ commits: { base, left, same }, tips: ['left', 'same'] })).toEqual({ records: { key: 'left' }, conflicts: {} });

  const merged = await commit(['left', 'right'], 'left', 'merged', { key: [await digest('left'), await digest('right')] });
  expect(await replayHistory({ commits: { base, left, right, merged }, tips: ['merged'] })).toEqual({ records: { key: 'merged' }, conflicts: {} });
});

it('preserves invalid resolution errors', async () => {
  const base = await commit([], null, 'one');
  const left = await commit(['base'], 'one', 'left');
  const right = await commit(['base'], 'one', 'right');
  const invalid = await commit(['left', 'right'], 'left', 'merged', { key: [] });
  await expect(replayHistory({ commits: { base, left, right, invalid }, tips: ['invalid'] })).rejects.toThrow('Invalid conflict resolution parents');
});
