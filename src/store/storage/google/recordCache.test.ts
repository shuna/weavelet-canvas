import { beforeEach, expect, it, vi } from 'vitest';
import { addContent, addContentDelta, type ContentStoreData } from '@utils/contentStore';
import type { ContentInterface } from '@type/chat';
import { digest } from './crypto';
import { cachedRecordDigest, clearRecordCaches, createContentProjector, getRecordCacheStats, RECORD_CACHE_BYTES } from './recordCache';

const parts = (text: string): ContentInterface[] => [{ type: 'text', text }];
const build = vi.fn(async (value: ContentInterface[]) => {
  const serialized = JSON.stringify(value);
  return { id: await digest(serialized), value: serialized, assets: {} };
});
beforeEach(() => { clearRecordCaches(); build.mockClear(); });

it('reuses values across store replacements and refCount changes, but notices in-place content changes', async () => {
  const store: ContentStoreData = { local: { content: parts('first'), refCount: 1 } };
  const first = await createContentProjector(store).project('local', build);
  const imported = structuredClone(store);
  imported.local.refCount = 99;
  expect(await createContentProjector(imported).project('local', build)).toEqual(first);
  expect(build).toHaveBeenCalledTimes(1);
  store.local.content = parts('second');
  expect((await createContentProjector(store).project('local', build)).value).not.toBe(first.value);
  expect(build).toHaveBeenCalledTimes(2);
  expect(getRecordCacheStats()).toMatchObject({ contentHits: 1, contentMisses: 2 });
});

it('checks all base values and refuses missing, cyclic or excessive chains even after prior hits', async () => {
  const store: ContentStoreData = {};
  const base = addContent(store, parts('Synthetic base '.repeat(80)));
  const target = addContentDelta(store, parts('Synthetic base '.repeat(80) + 'edit'), base);
  expect(store[target].delta).toBeDefined();
  const first = await createContentProjector(store).project(target, build);
  expect(await createContentProjector(structuredClone(store)).project(target, build)).toEqual(first);
  const changed = structuredClone(store);
  changed[base].content = parts('Synthetic base '.repeat(80) + ' changed base');
  await createContentProjector(changed).project(target, build);
  expect(build).toHaveBeenCalledTimes(2);
  const missing = structuredClone(store);
  delete missing[base];
  await expect(createContentProjector(missing).project(target, build)).rejects.toThrow(/Missing/);
  const cyclic = structuredClone(store);
  cyclic[base] = { content: [], refCount: 1, delta: { baseHash: target, patches: '' } };
  await expect(createContentProjector(cyclic).project(target, build)).rejects.toThrow(/cyclic/);
  const deep: ContentStoreData = { full: { content: parts('base'), refCount: 1 } };
  let previous = 'full';
  for (let i = 0; i < 100; i++) {
    deep[String(i)] = { content: [], refCount: 1, delta: { baseHash: previous, patches: '' } };
    previous = String(i);
  }
  await expect(createContentProjector(deep).project(previous, build)).rejects.toThrow(/deep/);
});

it('invalidates changed patches and preserves source/cache values against builder and caller mutation', async () => {
  const store: ContentStoreData = {};
  const base = addContent(store, parts('Fictional base '.repeat(80)));
  const target = addContentDelta(store, parts('Fictional base '.repeat(80) + 'one'), base);
  const first = await createContentProjector(store).project(target, build);
  store[target].delta!.patches = 'damaged patch';
  await expect(createContentProjector(store).project(target, build)).rejects.toThrow(/delta/);
  const assets = { image: 'fictional asset' };
  const original = JSON.stringify(store[base].content);
  const projected = await createContentProjector(store).project(base, async input => {
    input.push({ type: 'text', text: 'builder mutation' });
    return { id: 'immutable', value: 'value', assets };
  });
  assets.image = 'changed';
  expect(projected.assets.image).toBe('fictional asset');
  expect(Object.isFrozen(projected.assets)).toBe(true);
  expect(Object.isFrozen(projected)).toBe(true);
  expect(JSON.stringify(store[base].content)).toBe(original);
  expect(first.value).toContain('one');
});

it('supports uncached comparison, cached SHA digests and explicit clearing', async () => {
  const store: ContentStoreData = { local: { content: parts('fictional'), refCount: 1 } };
  const cached = await createContentProjector(store).project('local', build);
  expect(await createContentProjector(store, { cache: false }).project('local', build)).toEqual(cached);
  expect(build).toHaveBeenCalledTimes(2);
  expect(await cachedRecordDigest('value')).toBe(await digest('value'));
  expect(await cachedRecordDigest('value')).toBe(await cachedRecordDigest('value', { cache: false }));
  expect(getRecordCacheStats()).toMatchObject({ digestHits: 1, digestMisses: 2 });
  clearRecordCaches();
  expect(getRecordCacheStats()).toEqual({ contentHits: 0, contentMisses: 0, digestHits: 0, digestMisses: 0, bytes: 0, entries: 0 });
  await createContentProjector(store).project('local', build);
  expect(build).toHaveBeenCalledTimes(3);
});

it('bounds combined cache bytes, evicts old entries and skips oversized results', async () => {
  const store: ContentStoreData = { local: { content: parts('small'), refCount: 1 } };
  const large = 'x'.repeat(RECORD_CACHE_BYTES / 4);
  const project = async (id: string, value: string) => createContentProjector(store).project('local', async () => ({ id, value, assets: {} }));
  await project('large', large);
  expect(getRecordCacheStats().entries).toBe(1);
  await cachedRecordDigest(large);
  expect(getRecordCacheStats().entries).toBe(1);
  expect(getRecordCacheStats().bytes).toBeLessThanOrEqual(RECORD_CACHE_BYTES);
  await createContentProjector(store).project('local', build);
  expect(build).not.toHaveBeenCalled(); // A large digest must not evict body projections.
  const otherStore: ContentStoreData = { other: { content: parts('other'), refCount: 1 } };
  await createContentProjector(otherStore).project('other', async () => ({ id: 'other', value: large, assets: {} }));
  await createContentProjector(store).project('local', build);
  expect(build).toHaveBeenCalledTimes(1); // The newer projection evicted the oldest one.
  clearRecordCaches();
  await project('oversized', 'x'.repeat(RECORD_CACHE_BYTES / 2));
  expect(getRecordCacheStats().bytes).toBe(0);
});

it('does not repopulate a cache cleared while a projection was pending', async () => {
  const store: ContentStoreData = { local: { content: parts('pending'), refCount: 1 } };
  let finish!: () => void;
  const pending = createContentProjector(store).project('local', async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    return { id: 'id', value: 'value', assets: {} };
  });
  clearRecordCaches(); finish(); await pending;
  expect(getRecordCacheStats().entries).toBe(0);
});
