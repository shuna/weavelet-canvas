import { beforeAll, expect, it } from 'vitest';
import DiffMatchPatch from 'diff-match-patch';
import { decode, digest, encode } from './crypto';
import { decodeWire, encodeWire } from './wire';
import type { Commit } from './replay';
import { getSyncMetrics, resetSyncMetrics } from './metrics';

function noise(seed: number, length = 18000) {
  let state = seed;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(33 + state % 90);
  }).join('');
}
const body = (text: string) => JSON.stringify([{ text, type: 'text' }]);
const change = async (after: string) => ({ after, key: JSON.stringify(['content', await digest(after)]), before: null });
const dmp = new DiffMatchPatch();
let commit: Commit;
let encoded: Uint8Array;
let wrapper: any;

beforeAll(async () => {
  const base = noise(7);
  // Deliberately retain nonstandard object/property order to check the authenticated logical encoding.
  commit = { changes: await Promise.all([base, `${base.slice(0, 7000)} edited ${base.slice(7008)}`,
    `${base.slice(0, 12000)} another edit ${base.slice(12014)}`].map(text => change(body(text)))), parents: [], version: 1 };
  encoded = await encodeWire(commit);
  wrapper = decode<any>(encoded);
  expect(wrapper.format).toBe('weavelet-sync-delta');
});

it('selects actual compressed savings and preserves logical bytes, hashes and property order', async () => {
  expect(encoded.length).toBeLessThan(encode(commit).length);
  const restored = await decodeWire<Commit>(encoded);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(commit));
  expect(await digest(encode(restored))).toBe(await digest(encode(commit)));
  expect(commit.changes.every(change => typeof change.after === 'string')).toBe(true);
});

it('reads old complete payloads and keeps smaller/single/unrelated payloads in their original form', async () => {
  expect(await decodeWire<Commit>(encode(commit))).toEqual(commit);
  for (const value of [
    { version: 1 as const, parents: [], changes: [] },
    { ...commit, changes: commit.changes.slice(0, 1) },
    { ...commit, changes: await Promise.all([noise(12, 3000), noise(19, 3000)].map(text => change(body(text)))) },
  ]) expect(await encodeWire(value)).toEqual(encode(value));
});

it('shares one complete base without creating delta chains', async () => {
  const entries = wrapper.value.changes;
  expect(typeof entries[0].after).toBe('string');
  expect(entries.slice(1).every((entry: any) => entry.after.base === entries[0].key)).toBe(true);
  expect(await decodeWire<Commit>(encoded)).toEqual(commit);
});

it('encodes pack deltas across commits and preserves commit identities and property order', async () => {
  const pack = { commits: { second: { ...commit, changes: commit.changes.slice(0, 1) },
    first: { ...commit, parents: ['second'], changes: commit.changes.slice(1) } }, version: 1 as const };
  const bytes = await encodeWire(pack);
  expect(bytes.length).toBeLessThan(encode(pack).length);
  const restored = await decodeWire<typeof pack>(bytes);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(pack));
  for (const id of Object.keys(pack.commits) as (keyof typeof pack.commits)[]) {
    expect(await digest(encode(restored.commits[id]))).toBe(await digest(encode(pack.commits[id])));
  }
});

it('rejects missing or damaged bases, failed patches and mismatched target identities', async () => {
  for (const tamper of [
    (value: any) => { value.value.changes[0].after += ' '; },
    (value: any) => { value.value.changes[1].after.base = JSON.stringify(['content', '0'.repeat(64)]); },
    (value: any) => { value.value.changes[1].after.patches = 'not a patch'; },
    (value: any) => { value.value.changes[1].after.patches = dmp.patch_toText(dmp.patch_make('q'.repeat(100), 'x')); },
    (value: any) => { value.value.changes[1].after.patches = ''; },
    (value: any) => { value.value.changes[1].after.hash = '0'.repeat(64); },
  ]) {
    const damaged = structuredClone(wrapper); tamper(damaged);
    await expect(decodeWire(encode(damaged))).rejects.toThrow();
  }
});

it('rejects chain and cycle references even when the patches could otherwise restore the body', async () => {
  const chained = structuredClone(wrapper);
  chained.value.changes[2].after.base = chained.value.changes[1].key;
  await expect(decodeWire(encode(chained))).rejects.toThrow('Missing complete');
  const cyclic = structuredClone(wrapper);
  cyclic.value.changes[0].after = { ...cyclic.value.changes[1].after, base: cyclic.value.changes[1].key,
    hash: JSON.parse(cyclic.value.changes[0].key)[1] };
  await expect(decodeWire(encode(cyclic))).rejects.toThrow('Missing complete');
});

it('validates restored content types and hashes rather than trusting successful patch application', async () => {
  for (const restored of ['[{"type":"image_url","image_url":{"url":"synthetic"}}]', '{"type":"text","text":"not an array"}', '[]']) {
    const damaged = structuredClone(wrapper);
    const hash = await digest(restored);
    damaged.value.changes[1].key = JSON.stringify(['content', hash]);
    damaged.value.changes[1].after.hash = hash;
    damaged.value.changes[1].after.patches = dmp.patch_toText(dmp.patch_make(damaged.value.changes[0].after, restored));
    await expect(decodeWire(encode(damaged))).rejects.toThrow('Damaged sync content');
  }
});

it('rejects unknown wrapper versions and malformed delta objects', async () => {
  for (const tamper of [
    (value: any) => { value.version = 2; },
    (value: any) => { value.format = 'unknown'; },
    (value: any) => { value.value.changes[1].after.unrecognized = true; },
    (value: any) => { value.value.changes[1].key = JSON.stringify(['state', 'defaultSystemMessage']); },
  ]) {
    const damaged = structuredClone(wrapper); tamper(damaged);
    await expect(decodeWire(encode(damaged))).rejects.toThrow();
  }
});


it('does not expose patch text through parser errors', async () => {
  const damaged = structuredClone(wrapper);
  damaged.value.changes[1].after.patches = 'invalid-synthetic-patch-content';
  await expect(decodeWire(encode(damaged))).rejects.toThrow(/^Damaged sync content delta\.$/);
});


it('reuses trusted complete bytes while preserving the size decision and logical payload', async () => {
  const full = encode(commit);
  resetSyncMetrics();
  const reused = await encodeWire(commit, full);
  expect(reused).toEqual(encoded);
  expect(getSyncMetrics().serialize?.calls).toBe(1); // Only the delta candidate is encoded again.
  expect(await decodeWire(reused)).toEqual(commit);
  const single = { ...commit, changes: commit.changes.slice(0, 1) };
  const singleFull = encode(single);
  resetSyncMetrics();
  expect(await encodeWire(single, singleFull)).toBe(singleFull);
  expect(getSyncMetrics().serialize).toBeUndefined();
});
