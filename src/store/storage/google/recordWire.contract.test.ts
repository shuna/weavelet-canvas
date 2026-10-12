import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromRecords, toRecords, type Records, type Snapshot } from './records';
import { decode, digest, encode } from './crypto';
import { BROWSER_LOCAL_SETTINGS, SYNC_LOCAL_SETTINGS, isBrowserLocalRecord, withoutBrowserLocalSettings } from './settings';
const syncProjection = (snapshot: Snapshot): Snapshot => ({ ...snapshot, state: withoutBrowserLocalSettings(snapshot.state) });

// Swift consumes this same frozen fixture; Web changes must keep both consumers aligned.
const fixture = JSON.parse(readFileSync(
  new URL('../../../../tests/fixtures/web-native/record-wire.json', import.meta.url), 'utf8'
)) as {
  fixtureVersion: number;
  cases: { name: string; snapshot: Snapshot; records: Records; restored: Snapshot }[];
  legacyCases: { name: string; records: Records; restored: Snapshot }[];
  packets: { name: string; valueJSON: string; googleHex: string; sha256: string }[];
};

describe('shared Web/native record wire', () => {
  it('matches the explicit main sync-local policy without changing legacy fixtures', () => {
    const policy = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/web-native/sync-local-settings-policy.json', import.meta.url), 'utf8'));
    expect(policy.fixtureVersion).toBe(1);
    expect(policy.browserLocalSettings).toEqual(BROWSER_LOCAL_SETTINGS);
    expect(policy.syncLocalSettings).toEqual(SYNC_LOCAL_SETTINGS);
  });
  it.each([null, 0, 123, true, {}])('rejects a non-string branch root identity: %j', async value => {
    const records = { ...fixture.cases[0].records, '["chats","chat-a","branchTree","rootId"]': JSON.stringify(value) };
    await expect(fromRecords(records)).rejects.toThrow('Incomplete branch tree');
  });

  it('accepts an empty branch tree with the existing empty-string root convention', async () => {
    const snapshot = structuredClone(fixture.cases[0].snapshot);
    snapshot.state.chats![0].branchTree = { nodes: {}, activePath: [], rootId: '' };
    const restored = await fromRecords(await toRecords(snapshot));
    expect(restored.state.chats![0].branchTree).toEqual({ nodes: {}, activePath: [], rootId: '' });
  });

  function expectNodeOrder(actual: Snapshot, expected: Snapshot) {
    for (const [index, chat] of (expected.state.chats ?? []).entries()) {
      expect(Object.keys(actual.state.chats![index].branchTree?.nodes ?? {}))
        .toEqual(Object.keys(chat.branchTree?.nodes ?? {}));
    }
    expect(Object.keys(actual.state.branchClipboard?.nodes ?? {}))
      .toEqual(Object.keys(expected.state.branchClipboard?.nodes ?? {}));
  }

  it.each(fixture.cases)('$name matches the frozen record set and restored snapshot', async ({ snapshot, records, restored }) => {
    expect(fixture.fixtureVersion).toBe(2);
    const actual = await toRecords(structuredClone(snapshot));
    // Frozen shared fields remain exact; main keeps its explicit device-local settings out of sync.
    for (const [encoded, value] of Object.entries(records)) {
      if (isBrowserLocalRecord(encoded)) expect(actual[encoded]).toBeUndefined();
      else expect(actual[encoded]).toBe(value);
    }
    const extensionNames = new Set(['contentEntryFormat', 'contentEntries', 'contentEntryRefs', 'retainedContentEntries']);
    for (const encoded of Object.keys(actual)) if (!Object.hasOwn(records, encoded)) {
      expect(extensionNames.has(JSON.parse(encoded)[0]) || ['content', 'assets'].includes(JSON.parse(encoded)[0])).toBe(true);
    }
    expect(actual['["contentEntryFormat"]']).toBe('1');
    const decoded = await fromRecords(actual);
    const legacyContent = Object.fromEntries(Object.entries(restored.state.contentStore ?? {}).map(([hash]) => {
      const entry = decoded.state.contentStore![hash];
      return [hash, { content: entry.content, refCount: entry.refCount }];
    }));
    expect({ ...decoded, state: { ...decoded.state, contentStore: legacyContent } }).toEqual(syncProjection(restored));
    expectNodeOrder(decoded, restored);
    const expectedCount = Object.keys(snapshot.state.contentStore ?? {}).length;
    expect(Object.keys(decoded.state.contentStore ?? {})).toHaveLength(expectedCount);
    for (const [hash, entry] of Object.entries(snapshot.state.contentStore ?? {})) {
      const { content, refCount, delta, ...metadata } = entry;
      const sourceNode = Object.values(snapshot.state.chats![0].branchTree!.nodes).find(node => node.contentHash === hash);
      const expectedBody = delta
        ? restored.state.contentStore![restored.state.chats![0].branchTree!.nodes[sourceNode!.id].contentHash].content
        : content;
      expect(Object.values(decoded.state.contentStore!)).toContainEqual({ ...metadata, content: expectedBody, refCount: sourceNode ? (sourceNode.id === 'n-inactive' ? 2 : 1) : 0 });
    }
    expect(await toRecords(decoded)).toEqual(actual);
  });

  it.each(fixture.cases)('$name retains node order after record arrival order changes', async ({ records, restored }) => {
    const shuffled = Object.fromEntries(Object.entries(records).reverse());
    const decoded = await fromRecords(shuffled);
    expect(decoded).toEqual(syncProjection(restored));
    expectNodeOrder(decoded, restored);
  });

  it.each(fixture.legacyCases)('$name still reads the original record format', async ({ records, restored }) => {
    const decoded = await fromRecords(records);
    expect(decoded).toEqual(syncProjection(restored));
    expectNodeOrder(decoded, restored);
  });

  it.each(fixture.packets)('$name matches compressed packet bytes and hash', async ({ valueJSON, googleHex, sha256 }) => {
    const value: unknown = JSON.parse(valueJSON);
    const bytes = encode(value);
    expect(Buffer.from(bytes).toString('hex')).toBe(googleHex);
    expect(await digest(bytes)).toBe(sha256);
    // JSON.stringify intentionally serializes -0 as 0 on the wire.
    expect(decode(bytes)).toEqual(JSON.parse(JSON.stringify(value)));
  });
});
