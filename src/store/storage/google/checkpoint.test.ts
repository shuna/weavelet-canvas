import { expect, it } from 'vitest';
import { digest } from './crypto';
import { createCheckpoint, recordRoot, validateCheckpoint, verifyCheckpoint } from './checkpoint';
import type { Commit } from './replay';

const key = '["state","defaultSystemMessage"]';
const history = (): Record<string, Commit> => ({ initial: { version: 1, parents: [], changes: [{ key, before: null, after: '"fictional initial"' }] } });

it('creates/verifies canonical history and state roots, forwards progress and detaches received maps', async () => {
  const commits = history();
  commits.next = { version: 1, parents: ['initial'], changes: [{ key, before: await digest('"fictional initial"'), after: '"fictional next"' }] };
  const progress: string[] = [];
  const checkpoint = await createCheckpoint(commits, ['next'], item => progress.push(item.step));
  const reordered = { next: { changes: commits.next.changes, parents: commits.next.parents, version: 1 as const }, initial: commits.initial };
  const verified = await verifyCheckpoint(checkpoint, reordered);
  expect(verified.records[key]).toBe('"fictional next"');
  expect(verified.stateRoot).toBe(await recordRoot(verified.records, {}));
  expect(progress).toContain('scanning'); expect(progress).toContain('replaying');
  const racing = structuredClone(checkpoint), pending = validateCheckpoint(racing);
  racing.records[key] = '"mutated while digest was pending"';
  expect((await pending).records[key]).toBe('"fictional next"');
  checkpoint.records[key] = '"changed received object"'; checkpoint.tips.push('other');
  expect(verified.records[key]).toBe('"fictional next"'); expect(verified.tips).toEqual(['next']);
});

it('rejects a shape-valid, self-consistent forged snapshot rather than trusting matching IDs/tips/body hashes', async () => {
  const commits = history(), checkpoint = await createCheckpoint(commits, ['initial']);
  checkpoint.records[key] = '"wrong but valid JSON"';
  checkpoint.stateRoot = await recordRoot(checkpoint.records, checkpoint.conflicts);
  await expect(validateCheckpoint(checkpoint)).resolves.toBeDefined();
  await expect(verifyCheckpoint(checkpoint, commits)).rejects.toThrow('differs from replayed history');
});

it('rejects malformed roots, duplicate/mismatched tips, unknown coverage and changed commit content', async () => {
  const commits = history(), checkpoint = await createCheckpoint(commits, ['initial']);
  await expect(validateCheckpoint({ ...checkpoint, stateRoot: '0'.repeat(64) })).rejects.toThrow('Damaged');
  await expect(validateCheckpoint({ ...checkpoint, tips: ['initial', 'initial'] })).rejects.toThrow('Invalid');
  await expect(validateCheckpoint({ ...checkpoint, tips: ['unknown'] })).rejects.toThrow('Invalid');
  await expect(verifyCheckpoint({ ...checkpoint, commits: { ...checkpoint.commits, unknown: '0'.repeat(64) } }, commits)).rejects.toThrow('history does not match');
  const changed = history(); changed.initial.changes[0].after = '"changed history"';
  await expect(verifyCheckpoint(checkpoint, changed)).rejects.toThrow('history does not match');
  await expect(validateCheckpoint({ ...checkpoint, records: { '["__proto__"]': '{}' } })).rejects.toThrow('Invalid');
  const cyclic = history();
  cyclic.a = { version: 1, parents: ['b'], changes: [] };
  cyclic.b = { version: 1, parents: ['a'], changes: [] };
  await expect(createCheckpoint(cyclic, ['initial'])).rejects.toThrow('Cyclic');
});

it('retains concurrent conflicts and rejects checkpoints that discard them or omit a branch', async () => {
  const commits = history();
  const before = await digest('"fictional initial"');
  commits.left = { version: 1, parents: ['initial'], changes: [{ key, before, after: '"left"' }] };
  commits.right = { version: 1, parents: ['initial'], changes: [{ key, before, after: '"right"' }] };
  const checkpoint = await createCheckpoint(commits, ['right', 'left']);
  expect(checkpoint.conflicts[key]).toHaveLength(2);
  await expect(verifyCheckpoint(checkpoint, commits)).resolves.toBeDefined();
  const erased = { ...checkpoint, conflicts: {} };
  erased.stateRoot = await recordRoot(erased.records, erased.conflicts);
  await expect(verifyCheckpoint(erased, commits)).rejects.toThrow('differs from replayed history');
  await expect(createCheckpoint(commits, ['left'])).rejects.toThrow('tips do not match');
});
