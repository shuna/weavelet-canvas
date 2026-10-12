import DiffMatchPatch from 'diff-match-patch';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toRecords, fromRecords, hashRecords, diffRecords, applyChanges, SyncConflictError, type Snapshot } from './records';
import { mergeSyncRecords } from './merge';
import { replayHistory } from './replay';
import { releaseContent, flushPendingGC } from '@utils/contentStore';

const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/web-native/content-entry-wire.json', import.meta.url), 'utf8'));
const input = (): Snapshot => structuredClone(fixture.snapshot);
const key = (...path: string[]) => JSON.stringify(path);
const metadata = (s: Snapshot, nodeId: string, chatIndex = 0) => {
  const node = s.state.chats![chatIndex].branchTree!.nodes[nodeId];
  const { content, refCount, delta, ...extra } = s.state.contentStore![node.contentHash];
  return { content, metadata: extra };
};
const edit = (s: Snapshot, hash: string, origin: string) => {
  Object.assign(s.state.contentStore![hash], { xFuture: { origin } });
};
const merge = async (base: Snapshot, local: Snapshot, cloud: Snapshot) => fromRecords(await mergeSyncRecords(
  await hashRecords(await toRecords(base)), await toRecords(local), await toRecords(cloud),
));
const extensionNames = new Set(['contentEntryFormat', 'contentEntries', 'contentEntryRefs', 'retainedContentEntries']);

describe('content entry wire: handwritten semantic expectations and independent fixed digest vectors', () => {
  it('writes the fixed extension records and restores bodies, metadata, clipboard and unused entries without mutating input', async () => {
    const source = input(), before = structuredClone(source);
    const records = await toRecords(source);
    const extension = Object.fromEntries(Object.entries(records).filter(([encoded]) => extensionNames.has(JSON.parse(encoded)[0])));
    expect(extension).toEqual(fixture.expected.extensionRecords);
    const result = await fromRecords(Object.fromEntries(Object.entries(records).reverse()));
    expect(Object.keys(result.state.contentStore!)).toHaveLength(4);
    for (const expected of fixture.expected.entries) {
      const actual = expected.sourceKey === 'unused'
        ? Object.values(result.state.contentStore!).find(entry => (entry as any).xFuture?.origin === 'unused')!
        : result.state.contentStore![result.state.chats![0].branchTree!.nodes[expected.sourceKey].contentHash];
      expect(actual).toEqual({ ...expected.metadata, content: expected.content, refCount: expected.references });
    }
    expect(result.state.chats![0].branchTree!.nodes.left.contentHash).not.toBe(result.state.chats![0].branchTree!.nodes.right.contentHash);
    expect(result.state.branchClipboard!.nodes.clip.contentHash).toBe(result.state.chats![0].branchTree!.nodes.left.contentHash);
    expect(await toRecords(result)).toEqual(records);
    expect(source).toEqual(before);
  });

  it('expands a nonempty delta while retaining every unknown entry metadata field', async () => {
    const source = input(), dmp = new DiffMatchPatch();
    const expected = [{ type: 'text', text: 'FAKE TEST edited delta' }];
    source.state.contentStore!.delta.delta!.patches = dmp.patch_toText(dmp.patch_make(JSON.stringify(source.state.contentStore!.left.content), JSON.stringify(expected)));
    Object.assign(source.state.contentStore!.delta, { xNull: null, xArray: [true, { future: 'FAKE' }], nodeOrder: 'FAKE app attribute' });
    const result = await fromRecords(await toRecords(source));
    expect(metadata(result, 'delta')).toEqual({ content: expected, metadata: { xFuture: { origin: 'delta' }, xNull: null, xArray: [true, { future: 'FAKE' }], nodeOrder: 'FAKE app attribute' } });
    expect(result.state.contentStore![result.state.chats![0].branchTree!.nodes.delta.contentHash].delta).toBeUndefined();
  });

  it('reads legacy records with no entry extension and still validates their content', async () => {
    const records = Object.fromEntries(Object.entries(await toRecords(input())).filter(([encoded]) => !extensionNames.has(JSON.parse(encoded)[0])));
    const restored = await fromRecords(records);
    expect(Object.keys(restored.state.contentStore!)).toHaveLength(1);
    expect(metadata(restored, 'right')).toEqual({ content: [{ type: 'text', text: 'FAKE TEST body' }], metadata: {} });
    delete records[Object.keys(records).find(encoded => JSON.parse(encoded)[0] === 'content')!];
    await expect(fromRecords(records)).rejects.toThrow('Missing or damaged message content');
  });

  it.each(['marker-only', 'refs-only', 'missing-ref', 'missing-entry', 'missing-retained', 'unknown-format', 'invalid-retained', 'damaged-entry', 'missing-body'])('rejects partial or damaged extension: %s', async scenario => {
    let records = await toRecords(input());
    if (scenario === 'marker-only') records = Object.fromEntries(Object.entries(records).filter(([encoded]) => !extensionNames.has(JSON.parse(encoded)[0]) || JSON.parse(encoded)[0] === 'contentEntryFormat'));
    if (scenario === 'refs-only') delete records[key('contentEntryFormat')];
    if (scenario === 'missing-ref') delete records[key('contentEntryRefs', 'chats', 'entry-chat', 'right')];
    if (scenario === 'missing-entry') delete records[key('contentEntries', fixture.expected.entryIds.right)];
    if (scenario === 'missing-retained') for (const encoded of Object.keys(records)) if (JSON.parse(encoded)[0] === 'retainedContentEntries') delete records[encoded];
    if (scenario === 'unknown-format') records[key('contentEntryFormat')] = '2';
    if (scenario === 'invalid-retained') records[key('retainedContentEntries', fixture.expected.entryIds.unused)] = 'false';
    if (scenario === 'damaged-entry') records[key('contentEntries', fixture.expected.entryIds.right)] = '{"contentId":"fake","metadata":{}}';
    if (scenario === 'missing-body') delete records[Object.keys(records).find(encoded => JSON.parse(encoded)[0] === 'content')!];
    await expect(fromRecords(records)).rejects.toThrow();
  });

  it('rejects unsafe metadata keys on write, including nested metadata', async () => {
    for (const name of ['constructor', '__proto__', 'prototype']) {
      const source = input();
      Object.assign(source.state.contentStore!.left, { xUnsafe: JSON.parse(`{"${name}":"FAKE"}`) });
      await expect(toRecords(source)).rejects.toThrow('Unsafe sync record key');
    }
  });

  it('rejects a raw body/metadata mixture before restoring it', async () => {
    const base = input(), body = input(), meta = input();
    body.state.contentStore!.right.content = [{ type: 'text', text: 'FAKE TEST changed body' }];
    edit(meta, 'right', 'changed metadata');
    const baseline = await toRecords(base), bodyRecords = await toRecords(body), metaRecords = await toRecords(meta);
    await expect(applyChanges(metaRecords, await diffRecords(baseline, bodyRecords))).rejects.toBeInstanceOf(SyncConflictError);
    const incompleteChanges = (await diffRecords(baseline, bodyRecords)).filter(change => JSON.parse(change.key)[0] !== 'contentEntryRefs');
    const mixed = await applyChanges(metaRecords, incompleteChanges);
    await expect(fromRecords(mixed)).rejects.toThrow('Inconsistent content entry reference');
  });

  it('keeps both same-body metadata alternatives and both body/metadata alternatives through branch merge', async () => {
    const base = input(), local = input(), cloud = input();
    edit(local, 'right', 'local metadata'); edit(cloud, 'right', 'cloud metadata');
    const result = await merge(base, local, cloud);
    const alternatives = Object.values(result.state.chats![0].branchTree!.nodes).filter(node => node.parentId === 'left');
    expect(alternatives.map(node => metadata(result, node.id))).toEqual(expect.arrayContaining([
      { content: [{ type: 'text', text: 'FAKE TEST body' }], metadata: { xFuture: { origin: 'local metadata' } } },
      { content: [{ type: 'text', text: 'FAKE TEST body' }], metadata: { xFuture: { origin: 'cloud metadata' } } },
    ]));
    cloud.state.contentStore!.right.content = [{ type: 'text', text: 'FAKE TEST changed body' }];
    const changed = await merge(base, local, cloud);
    expect(Object.values(changed.state.chats![0].branchTree!.nodes).map(node => metadata(changed, node.id))).toEqual(expect.arrayContaining([
      { content: [{ type: 'text', text: 'FAKE TEST body' }], metadata: { xFuture: { origin: 'local metadata' } } },
      { content: [{ type: 'text', text: 'FAKE TEST changed body' }], metadata: { xFuture: { origin: 'cloud metadata' } } },
    ]));
  });

  it('moves entry references with copied chat IDs and retains concurrent metadata edits against deletion', async () => {
    const base = input(), local = input(), cloud = input();
    local.state.chats![0].title = 'FAKE Local'; cloud.state.chats![0].title = 'FAKE Cloud';
    edit(local, 'right', 'local metadata'); edit(cloud, 'right', 'cloud metadata');
    const copied = await merge(base, local, cloud);
    expect(copied.state.chats).toHaveLength(2);
    for (let i = 0; i < 2; i++) expect(metadata(copied, 'right', i).metadata).toEqual({ xFuture: { origin: copied.state.chats![i].title === 'FAKE Local' ? 'local metadata' : 'cloud metadata' } });
    const deleted = input();
    delete deleted.state.chats![0].branchTree!.nodes.right;
    deleted.state.chats![0].branchTree!.activePath = ['left'];
    delete deleted.state.contentStore!.right;
    const retained = await merge(base, deleted, cloud);
    expect(metadata(retained, 'right').metadata).toEqual({ xFuture: { origin: 'cloud metadata' } });
  });

  it('selects clipboard body and metadata together when both sides edit the same entry', async () => {
    const base = input(), local = input(), cloud = input();
    edit(local, 'left', 'local clipboard metadata');
    cloud.state.contentStore!.left.content = [{ type: 'text', text: 'FAKE cloud clipboard body' }];
    const result = await merge(base, local, cloud);
    const actual = result.state.contentStore![result.state.branchClipboard!.nodes.clip.contentHash];
    expect(actual).toEqual({ content: [{ type: 'text', text: 'FAKE TEST body' }], refCount: 2, xFuture: { origin: 'local clipboard metadata' } });
    expect(Object.values(result.state.chats![0].branchTree!.nodes).map(node => metadata(result, node.id))).toEqual(expect.arrayContaining([
      { content: [{ type: 'text', text: 'FAKE cloud clipboard body' }], metadata: { xFuture: { origin: 'left', values: [1, null] } } },
    ]));
  });

  it('replays independent metadata edits and additions without an order/list conflict, including later parent commits', async () => {
    const base = input(), local = input(), cloud = input();
    edit(local, 'right', 'local independent'); edit(cloud, 'delta', 'cloud independent');
    Object.assign(local.state.contentStore!, { localUnused: { content: [{ type: 'text', text: 'FAKE local unused' }], refCount: 0, xFuture: { origin: 'local unused' } } });
    Object.assign(cloud.state.contentStore!, { cloudUnused: { content: [{ type: 'text', text: 'FAKE cloud unused' }], refCount: 0, xFuture: { origin: 'cloud unused' } } });
    const b = await toRecords(base), l = await toRecords(local), c = await toRecords(cloud);
    const commits = { base: { version: 1 as const, parents: [], changes: await diffRecords({}, b) }, local: { version: 1 as const, parents: ['base'], changes: await diffRecords(b, l) }, cloud: { version: 1 as const, parents: ['base'], changes: await diffRecords(b, c) } };
    const replayed = await replayHistory({ commits, tips: ['local', 'cloud'] });
    expect(replayed.conflicts).toEqual({});
    const result = await fromRecords(replayed.records);
    expect(metadata(result, 'right').metadata).toEqual({ xFuture: { origin: 'local independent' } });
    expect(metadata(result, 'delta').metadata).toEqual({ xFuture: { origin: 'cloud independent' } });
    expect(Object.values(result.state.contentStore!).map(entry => (entry as any).xFuture.origin)).toEqual(expect.arrayContaining(['local unused', 'cloud unused']));
    const later = { version: 1 as const, parents: ['local', 'cloud'], changes: await diffRecords(replayed.records, await toRecords(result)) };
    expect((await replayHistory({ commits: { ...commits, later }, tips: ['later'] })).conflicts).toEqual({});
  });

  it('keeps an unused entry until explicit GC, then ignores leftover immutable wire records', async () => {
    const source = input(), before = await toRecords(source);
    releaseContent(source.state.contentStore!, 'unused');
    expect(flushPendingGC(source.state.contentStore!)).toEqual(['unused']);
    const after = await toRecords(source);
    const changes = (await diffRecords(before, after)).filter(change => change.after !== null || !['contentEntries', 'content', 'assets'].includes(JSON.parse(change.key)[0]));
    const remote = await applyChanges(before, changes);
    expect(remote[key('contentEntries', fixture.expected.entryIds.unused)]).toBeDefined();
    expect(remote[key('retainedContentEntries', fixture.expected.entryIds.unused)]).toBeUndefined();
    const restored = await fromRecords(remote);
    expect(Object.keys(restored.state.contentStore!)).toHaveLength(3);
    expect(Object.values(restored.state.contentStore!).some(entry => (entry as any).xFuture.origin === 'unused')).toBe(false);
  });
});
