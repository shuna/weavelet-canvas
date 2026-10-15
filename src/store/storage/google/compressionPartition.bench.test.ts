import { expect, it } from 'vitest';
import { partitionCompression, restoreCompression, compressionPartitionStats, type CompressionPayload } from './compressionPartition.bench';
import { createSyntheticSnapshot } from './synthetic';
import { diffRecords, toRecords } from './records';
import { addContent } from '@utils/contentStore';
import type { Commit } from './replay';

it('round-trips generated tree/legacy/asset records exactly and reports all byte components', async () => {
  const snapshot = createSyntheticSnapshot({ bodyBytes: 128, profile: {
    treeChats: 2, treeNodes: 12, legacyChats: 3, legacyNodes: 17,
    maxTreeNodes: 8, maxDepth: 4, maxFanout: 3, targetJsonBytes: 0,
  } });
  const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,c3ludGhldGlj', detail: 'auto' as const } };
  const tree = snapshot.state.chats![0].branchTree!;
  tree.nodes[tree.rootId].contentHash = addContent(snapshot.state.contentStore!, [
    { type: 'text', text: 'Synthetic tree image fixture.' }, image,
  ]);
  snapshot.state.chats![2].messages![0].content.push(image);
  const records = await toRecords(snapshot);
  const commit: Commit = { version: 1, parents: [], changes: await diffRecords({}, records) };
  const before = JSON.stringify(commit);
  const partition = partitionCompression(commit);
  expect(JSON.stringify(restoreCompression(partition))).toBe(before);
  expect(JSON.stringify(commit)).toBe(before);
  const stats = compressionPartitionStats(partition);
  expect(stats.contentRecordCount).toBeGreaterThan(0);
  expect(stats.assetRecordCount).toBe(1);
  expect(stats.legacyBodyRecordCount).toBe(3);
  expect(stats.metadataRecordCount).toBeGreaterThan(0);
  expect(stats.bodyRecordCount + stats.metadataRecordCount).toBe(stats.recordCount);
  expect(stats.metadataJsonBytes + stats.bodyJsonBytes + stats.jsonWrapperBytes).toBe(stats.jsonTotalBytes);
  expect(stats.logicalJsonBytes).toBe(new TextEncoder().encode(before).length);
  expect(stats.legacyInlineFieldsRemainInBody).toBe(true);
});

it('preserves pack/key/property order, opaque JSON spelling, whitespace, Unicode and null deletions', () => {
  const body = String.raw`[ { "type" : "text", "text" : "\u65e5日本語🙂\n" } ]  ` + String.fromCharCode(10, 9);
  const commit: Commit = { changes: [
    { after: body, before: 'previous hash', key: JSON.stringify(['content', 'body']) },
    { key: JSON.stringify(['assets', 'image']), after: '  "data:image/png;synthetic"  ', before: null },
    { before: null, key: JSON.stringify(['chats', 'legacy', 'messages']), after: '[ { "content" : [], "role" : "user" } ]' },
    { after: null, key: JSON.stringify(['content', 'deleted']), before: 'deleted hash' },
    { key: JSON.stringify(['chats', 'id', 'messages', 'nested']), before: null, after: 'metadata' },
  ], parents: ['second', 'first'], version: 1 };
  const payload = { commits: { z: commit, a: { ...commit, parents: ['z'] } }, version: 1 as const };
  const partition = partitionCompression(payload);
  expect(partition.bodies[0]).toBe(body);
  expect(JSON.stringify(restoreCompression(partition))).toBe(JSON.stringify(payload));
  const stats = compressionPartitionStats(partition);
  expect(stats.bodyRecordCount).toBe(6);
  expect(stats.metadataRecordCount).toBe(4);
  expect(stats.bodyReferenceJsonBytes).toBeGreaterThan(0);
});

it('never expands unsafe path strings or pack keys into object assignments', () => {
  const commits = Object.create(null);
  commits.__proto__ = { version: 1, parents: [], changes: [
    { key: JSON.stringify(['state', '__proto__', 'polluted']), before: null, after: 'true' },
    { key: JSON.stringify(['chats', 'constructor', 'messages']), before: null, after: '[]' },
  ] };
  const payload: CompressionPayload = { commits, version: 1 };
  const restored = restoreCompression(partitionCompression(payload));
  expect(JSON.stringify(restored)).toBe(JSON.stringify(payload));
  expect(Object.hasOwn((restored as any).commits, '__proto__')).toBe(true);
  expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
});

it('rejects invalid, duplicate and unused body references and malformed partitions', () => {
  const original = partitionCompression({ version: 1, parents: [], changes: [
    { key: JSON.stringify(['content', 'a']), before: null, after: 'a' },
    { key: JSON.stringify(['assets', 'b']), before: null, after: 'b' },
  ] });
  for (const tamper of [
    (value: any) => { value.version = 2; },
    (value: any) => { value.bodies.push('unused'); },
    (value: any) => { value.metadata.changes[0].after.body = -1; },
    (value: any) => { value.metadata.changes[1].after.body = 0; },
    (value: any) => { value.metadata.changes[0].after.extra = true; },
    (value: any) => { value.metadata.changes[0].key = JSON.stringify(['state', 'setting']); },
  ]) {
    const damaged = structuredClone(original); tamper(damaged);
    expect(() => restoreCompression(damaged)).toThrow();
  }
});
