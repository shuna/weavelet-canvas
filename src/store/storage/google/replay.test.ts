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

it('combines edit timestamps without hiding content or deletion conflicts', async () => {
  const key = JSON.stringify(['chats', 'chat', 'updatedAt']);
  const dated = async (parents: string[], before: string | null, after: string | null) => ({
    ...await commit(parents, before, after), changes: [{ key, before: before === null ? null : await digest(before), after }],
  });
  const base = await dated([], null, '1000');
  const left = await dated(['base'], '1000', '2000');
  const right = await dated(['base'], '1000', '3000');
  expect(await replayHistory({ commits: { base, left, right }, tips: ['left', 'right'] })).toEqual({ records: { [key]: '3000' }, conflicts: {} });
  const next = await dated(['left', 'right'], '3000', '4000');
  expect((await replayHistory({ commits: { base, left, right, next }, tips: ['next'] })).records[key]).toBe('4000');
  const removed = await dated(['base'], '1000', null);
  expect((await replayHistory({ commits: { base, left, removed }, tips: ['left', 'removed'] })).conflicts[key]).toHaveLength(2);
});

it.each([
  ['state', 'pendingVerifications', 'generation', 'status'],
  ['state', 'verifiedStats', 'generation', 'fetchedAt'],
  ['state', 'providerModelCache', 'openrouter'],
  ['state', 'totalTokenUsed', 'model', 'promptTokens'],
  ['state', 'theme'], ['state', 'folders', 'folder', 'expanded'],
  ['chats', 'chat', 'collapsedNodes', 'bubble'],
  ['chats', 'chat', 'branchTree', 'activePath'],
])('does not block on legacy state conflicts at %j, including descendants and resolutions', async (...path) => {
  const key = JSON.stringify(path);
  const dated = async (parents: string[], before: string | null, after: string | null, resolutions?: Commit['resolutions']) => ({
    ...await commit(parents, before, after, resolutions), changes: [{ key, before: before === null ? null : await digest(before), after }],
  });
  const base = await dated([], null, '0'), left = await dated(['base'], '0', '1'), right = await dated(['base'], '0', '2');
  expect((await replayHistory({ commits: { base, left, right }, tips: ['left', 'right'] })).conflicts).toEqual({});
  const next = await dated(['left', 'right'], '2', '3');
  expect((await replayHistory({ commits: { base, left, right, next }, tips: ['next'] })).records[key]).toBe('3');
  const resolved = await dated(['left', 'right'], '1', '4', { [key]: [await digest('1'), await digest('2')] });
  expect((await replayHistory({ commits: { base, left, right, resolved }, tips: ['resolved'] })).records[key]).toBe('4');
  const invalid = await dated(['left', 'right'], '9', '3');
  await expect(replayHistory({ commits: { base, left, right, invalid }, tips: ['invalid'] })).rejects.toThrow('conflict');
});

it.each([
  ['chats', 'chat', 'branchTree', 'nodes', 'bubble', 'contentHash'],
  ['state', 'evaluationResults', 'evaluation', 'score'],
  ['state', 'folders', 'folder', 'name'],
])('keeps important concurrent edits and deletions at %j as manual conflicts', async (...path) => {
  const key = JSON.stringify(path);
  const dated = async (parents: string[], before: string | null, after: string | null) => ({
    ...await commit(parents, before, after), changes: [{ key, before: before === null ? null : await digest(before), after }],
  });
  const base = await dated([], null, '0'), left = await dated(['base'], '0', '1');
  for (const value of ['2', null]) {
    const right = await dated(['base'], '0', value);
    expect((await replayHistory({ commits: { base, left, right }, tips: ['left', 'right'] })).conflicts[key]).toHaveLength(2);
  }
});

it('selects a surviving active branch when navigation races with node deletion in existing history', async () => {
  const { toRecords, fromRecords, diffRecords } = await import('./records');
  const { addContent } = await import('@utils/contentStore');
  const contentStore = {};
  const contentHash = addContent(contentStore, [{ type: 'text', text: 'retained text' }]);
  const baseSnapshot = { version: 18, state: { contentStore, chats: [{ id: 'chat', title: 'Chat', messages: [], titleSet: true, imageDetail: 'auto' as const,
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    branchTree: { rootId: 'root', activePath: ['root', 'a'], nodes: {
      root: { id: 'root', parentId: null, role: 'user' as const, contentHash, createdAt: 1 },
      a: { id: 'a', parentId: 'root', role: 'assistant' as const, contentHash, createdAt: 1 },
      b: { id: 'b', parentId: 'root', role: 'assistant' as const, contentHash, createdAt: 1 },
    } },
  }] } };
  const before = await toRecords(baseSnapshot);
  const navigated = structuredClone(baseSnapshot); navigated.state.chats[0].branchTree.activePath = ['root', 'b'];
  const removed = structuredClone(baseSnapshot); delete (removed.state.chats[0].branchTree.nodes as Record<string, unknown>).b;
  const base: Commit = { version: 1, parents: [], changes: await diffRecords({}, before) };
  const left: Commit = { version: 1, parents: ['aaa'], changes: await diffRecords(before, await toRecords(navigated)) };
  const right: Commit = { version: 1, parents: ['aaa'], changes: await diffRecords(before, await toRecords(removed)) };
  const result = await replayHistory({ commits: { aaa: base, bbb: left, ccc: right }, tips: ['bbb', 'ccc'] });
  expect(result.conflicts).toEqual({});
  const restored = await fromRecords(result.records);
  expect(restored.state.chats![0].branchTree!.activePath).toEqual(['root']);
  expect(restored.state.chats![0].branchTree!.nodes.b).toBeUndefined();
  restored.state.chats![0].branchTree!.activePath = ['root', 'a'];
  const continued: Commit = { version: 1, parents: ['bbb', 'ccc'], changes: await diffRecords(result.records, await toRecords(restored)) };
  const next = await replayHistory({ commits: { aaa: base, bbb: left, ccc: right, ddd: continued }, tips: ['ddd'] });
  expect(next.conflicts).toEqual({});
  expect((await fromRecords(next.records)).state.chats![0].branchTree!.activePath).toEqual(['root', 'a']);
  const invalid = structuredClone(continued);
  invalid.changes.find(change => change.key.endsWith(',"activePath"]'))!.before = await digest('unrelated value');
  await expect(replayHistory({ commits: { aaa: base, bbb: left, ccc: right, ddd: invalid }, tips: ['ddd'] })).rejects.toThrow('Concurrent edits conflict');
});
