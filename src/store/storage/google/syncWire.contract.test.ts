import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compress, decompress } from 'lz-string';
import { toRecords, fromRecords, applyChanges, type Snapshot } from './records';
import { replayHistory, type Commit } from './replay';
import { createKeyEnvelope, unlockKey, encrypt, decrypt, encode, decode, digest, type KeyEnvelope } from './crypto';
import { withoutBrowserLocalSettings } from './settings';
import { getSiblingsOf } from '@utils/branchUtils';
import { lzStringToBase64, base64ToLzString } from '../cloud/providers/cloudkit';
import { CLOUDKIT_DEFAULT_RECORD_NAME, saveCloudKitRecord } from '@api/cloudkit';

vi.mock('@store/cloud-auth-store', () => ({ default: { getState: () => ({}) } }));

const corpus = JSON.parse(readFileSync(
  new URL('../../../../tests/fixtures/web-native/io-corpus.json', import.meta.url), 'utf8'
)) as { syncSnapshot: Snapshot };
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));

// Fixed fake vectors generated independently with Node pbkdf2Sync/createCipheriv, then frozen.
const fakePassword = 'FAKE TEST ONLY long passphrase';
const rawKey = bytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const iv = bytes('000102030405060708090a0b');
const envelope: KeyEnvelope = {
  format: 'weavelet-encrypted-sync', version: 1,
  salt: [...bytes('000102030405060708090a0b0c0d0e0f')], iterations: 600_000,
  wrappedKey: [...bytes('000102030405060708090a0b245b447cdbe818411d99c187cc4469f91587e6d7327173acf7a9b94fa7eab14f672551c99f33953d372639ed62a15485')],
};
const ciphertext = bytes('000102030405060708090a0b01439d5ee5b18748d961711c140fe4c16b7c19cf1a0a2e9e74ba8147749ed3f1bec212');
const compressedVector = bytes('378220660860d60a6205c2429e9a069cd07951202f90');
const wireHashes = {
  'n-system': '1f361e5e0c7634b0620ca26ac4ca0cc67643ef2532c23a7502ceacb0bd589b23',
  'n-user': '50de279dcc60a92ff2ae87bfdbdace93e1d04597464b7ba0ba3e61efdd9abd72',
  'n-inactive': '957269cbeecf39e4f9b91c154f41a68ae3e9d316d423905561dda4a4a06c1cd7',
  'n-assistant': '6374c58c158203facda57778759ddb3a54dd58849ae8a5de3f4cc82e0322bea8',
};
const imageAssetId = 'e3a0340df2d90923c940a70a789d8a15dc2e3be417b0b584440cf5916052692c';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Google record wire: synthetic full corpus', () => {
  it('matches fixed canonical record/hash vectors and does not mutate its snapshot', async () => {
    const input = structuredClone(corpus.syncSnapshot);
    const records = await toRecords(input);
    expect(input).toEqual(corpus.syncSnapshot);
    expect(records['["version"]']).toBe('18');
    expect(records['["order"]']).toBe('["chat-a","chat-b"]');
    expect(records['["state","xFixtureRoot","unknown"]']).toBe('"keep-root"');
    expect(records['["chats","chat-a","config","model"]']).toBe('"FAKE-TEST-MODEL"');
    for (const [id, hash] of Object.entries(wireHashes)) {
      expect(records[JSON.stringify(['chats', 'chat-a', 'branchTree', 'nodes', id, 'contentHash'])])
        .toBe(JSON.stringify(hash));
    }
    expect(records[JSON.stringify(['assets', imageAssetId])]).toBe('"data:image/png;base64,FAKE_TEST_IMAGE"');
    const expectedParts = structuredClone(corpus.syncSnapshot.state.contentStore!.rich.content) as unknown as Record<string, unknown>[];
    (expectedParts[1].image_url as Record<string, unknown>).url = { asset: imageAssetId };
    expect(JSON.parse(records[JSON.stringify(['content', wireHashes['n-user']])])).toEqual(expectedParts);
  });

  it('restores every synchronized state field and node/content meaning, retaining entry metadata with derived refcounts', async () => {
    const restored = await fromRecords(await toRecords(corpus.syncSnapshot));
    const { chats: sourceChats, contentStore: sourceStore, ...expectedState } = corpus.syncSnapshot.state;
    const { chats, contentStore, ...state } = restored.state;
    const expectedClipboard = structuredClone(expectedState.branchClipboard!);
    const clipboardHash = restored.state.branchClipboard!.nodes['n-inactive'].contentHash;
    expectedClipboard.nodes['n-inactive'].contentHash = clipboardHash;
    expect(state).toEqual({ ...withoutBrowserLocalSettings(expectedState), branchClipboard: expectedClipboard });
    expect(restored.version).toBe(18);
    expect(chats!.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b']);
    expect(chats![1]).toEqual(sourceChats![1]);
    const expectedChat = structuredClone(sourceChats![0]);
    delete expectedChat.messages;
    for (const [id, sourceNode] of Object.entries(sourceChats![0].branchTree!.nodes)) {
      const node = chats![0].branchTree!.nodes[id];
      expectedChat.branchTree!.nodes[id].contentHash = node.contentHash;
      expect({ ...node, contentHash: sourceNode.contentHash }).toEqual(sourceNode);
      expect(contentStore![node.contentHash]).toEqual({
        ...sourceStore![sourceNode.contentHash],
        refCount: id === 'n-inactive' ? 2 : 1,
      });
    }
    expect(chats![0]).toEqual(expectedChat);
    expect(clipboardHash).toBe(chats![0].branchTree!.nodes['n-inactive'].contentHash);
    expect(Object.keys(contentStore!)).toHaveLength(5);
    expect(Object.values(contentStore!)).toContainEqual({ ...sourceStore!.unreferenced, refCount: 0 });
  });

  it('preserves explicit sibling order when the same records arrive in another order', async () => {
    const records = await toRecords(corpus.syncSnapshot);
    const sorted = Object.fromEntries(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
    const restored = await fromRecords(sorted);
    const sourceTree = corpus.syncSnapshot.state.chats![0].branchTree!;
    expect(getSiblingsOf(sourceTree, 'n-inactive').map((node) => node.id))
      .toEqual(['n-inactive', 'n-assistant']);
    expect(getSiblingsOf(restored.state.chats![0].branchTree!, 'n-inactive').map((node) => node.id))
      .toEqual(['n-inactive', 'n-assistant']);
    expect(records['["nodeOrder","chats","chat-a"]'])
      .toBe('["n-system","n-user","n-inactive","n-assistant"]');
  });

  it('keeps the previous arrival-order behavior for records without nodeOrder metadata', async () => {
    const records = await toRecords(corpus.syncSnapshot);
    const legacy = Object.fromEntries(Object.entries(records)
      .filter(([key]) => JSON.parse(key)[0] !== 'nodeOrder').sort(([a], [b]) => a.localeCompare(b)));
    const restored = await fromRecords(legacy);
    expect(getSiblingsOf(restored.state.chats![0].branchTree!, 'n-inactive').map((node) => node.id))
      .toEqual(['n-assistant', 'n-inactive']);
  });

  it('ignores deleted IDs and deterministically adds new IDs missing from explicit order', async () => {
    const records = await toRecords(corpus.syncSnapshot);
    records['["nodeOrder","chats","chat-a"]'] = '["deleted","n-inactive","n-system"]';
    const restored = await fromRecords(Object.fromEntries(Object.entries(records).reverse()));
    expect(Object.keys(restored.state.chats![0].branchTree!.nodes))
      .toEqual(['n-inactive', 'n-system', 'n-assistant', 'n-user']);
    expect(restored.state.chats![0].branchTree!.activePath).toEqual(['n-system', 'n-user', 'n-assistant']);
  });

  it('preserves clipboard order and separate application attributes named nodeOrder', async () => {
    const input = structuredClone(corpus.syncSnapshot);
    Object.assign(input.state, { nodeOrder: { fake: 'keep app state' } });
    const tree = input.state.chats![0].branchTree!;
    Object.assign(tree, { nodeOrder: { fake: 'keep app tree' } });
    input.state.branchClipboard!.nodes = {
      'n-user': { ...tree.nodes['n-user'] }, 'n-system': { ...tree.nodes['n-system'] },
    };
    input.state.branchClipboard!.nodeIds = ['n-user', 'n-system'];
    const records = await toRecords(input);
    expect(records['["nodeOrder","clipboard"]']).toBe('["n-user","n-system"]');
    const restored = await fromRecords(Object.fromEntries(Object.entries(records).reverse()));
    expect(Object.keys(restored.state.branchClipboard!.nodes)).toEqual(['n-user', 'n-system']);
    expect(restored.state.branchClipboard!.nodeIds).toEqual(['n-user', 'n-system']);
    expect(restored.state).toHaveProperty('nodeOrder', { fake: 'keep app state' });
    expect(restored.state.chats![0].branchTree).toHaveProperty('nodeOrder', { fake: 'keep app tree' });
  });

  it('restores integer-index keys in JavaScript order before other IDs', async () => {
    const input = structuredClone(corpus.syncSnapshot);
    const tree = input.state.chats![0].branchTree!;
    const original = tree.nodes['n-user'];
    tree.nodes = Object.fromEntries(['alpha', '7', '1', '01'].map(id => [id, { ...original, id, parentId: null }]));
    tree.rootId = '1'; tree.activePath = ['1'];
    input.state.branchClipboard = null;
    const records = await toRecords(input);
    expect(records['["nodeOrder","chats","chat-a"]']).toBe('["1","7","alpha","01"]');
    records['["nodeOrder","chats","chat-a"]'] = '["7","alpha","1","01"]';
    const restored = await fromRecords(Object.fromEntries(Object.entries(records).reverse()));
    expect(Object.keys(restored.state.chats![0].branchTree!.nodes)).toEqual(['1', '7', 'alpha', '01']);
  });

  it.each(['null', '{}', '[1]', '["n-user","n-user"]'])('rejects malformed node order %s', async value => {
    const records = await toRecords(corpus.syncSnapshot);
    records['["nodeOrder","chats","chat-a"]'] = value;
    await expect(fromRecords(records)).rejects.toThrow('Invalid sync node order');
  });

  it('merges independent node order additions while retaining normal record conflict checks', async () => {
    const key = '["nodeOrder","chats","chat"]';
    const before = await digest('["root"]');
    const records = { [key]: '["root","remote"]' };
    const changes = [{ key, before, after: '["root","local"]' }];
    expect(await applyChanges(records, changes)).toEqual({ [key]: '["root","remote","local"]' });
    expect(records).toEqual({ [key]: '["root","remote"]' });
    expect(changes).toEqual([{ key, before, after: '["root","local"]' }]);
    await expect(applyChanges({ '["state","title"]': '"remote"' }, [{
      key: '["state","title"]', before, after: '"local"',
    }])).rejects.toThrow('conflict');
  });

  it('replays concurrent order additions and later parent commits regardless of tip listing order', async () => {
    const key = '["nodeOrder","chats","chat"]';
    const before = await digest('["root"]');
    const commits: Record<string, Commit> = {
      base: { version: 1, parents: [], changes: [{ key, before: null, after: '["root"]' }] },
      left: { version: 1, parents: ['base'], changes: [{ key, before, after: '["root","left"]' }] },
      right: { version: 1, parents: ['base'], changes: [{ key, before, after: '["root","right"]' }] },
    };
    for (const tips of [['left', 'right'], ['right', 'left']]) {
      expect(await replayHistory({ commits, tips })).toEqual({
        records: { [key]: '["root","left","right"]' }, conflicts: {},
      });
    }
    commits.next = { version: 1, parents: ['left', 'right'], changes: [{
      key, before: await digest('["root","left","right"]'), after: '["root","left","right","next"]',
    }] };
    commits.remove = { version: 1, parents: ['next'], changes: [{
      key, before: await digest('["root","left","right","next"]'), after: '["root","right","next"]',
    }] };
    expect(await replayHistory({ commits, tips: ['remove'] })).toEqual({
      records: { [key]: '["root","right","next"]' }, conflicts: {},
    });
  });

  it('preserves a pinned missing-parent branch, its unpinned child, metadata and content on sync read', async () => {
    const input = structuredClone(corpus.syncSnapshot);
    const tree = input.state.chats![0].branchTree!;
    const node = tree.nodes['n-inactive'];
    node.pinned = true;
    node.parentId = 'missing-parent';
    tree.nodes['n-orphan-child'] = {
      id: 'n-orphan-child', parentId: 'n-inactive', role: 'assistant',
      contentHash: 'rich', createdAt: 5, label: '合成孤立枝の子', pinned: false,
    };
    const before = structuredClone(input);
    const restored = await fromRecords(await toRecords(input));
    for (const id of ['n-inactive', 'n-orphan-child']) {
      const sourceNode = tree.nodes[id];
      const actual = restored.state.chats![0].branchTree!.nodes[id];
      expect({ ...actual, contentHash: sourceNode.contentHash }).toEqual(sourceNode);
      expect(restored.state.contentStore![actual.contentHash]).toEqual({
        ...input.state.contentStore![sourceNode.contentHash], refCount: 2,
      });
    }
    expect(restored.state.chats![0].branchTree!.rootId).toBe('n-system');
    expect(restored.state.chats![0].branchTree!.activePath).toEqual(['n-system', 'n-user', 'n-assistant']);
    expect(input).toEqual(before);
  });

  it.each([
    { name: 'unpinned missing parent', path: ['chats', 'chat-a', 'branchTree', 'nodes', 'n-inactive', 'pinned'], value: 'false', error: 'Orphaned' },
    { name: 'nonboolean pinned missing parent', path: ['chats', 'chat-a', 'branchTree', 'nodes', 'n-inactive', 'pinned'], value: '"true"', error: 'Orphaned' },
    { name: 'mismatched node ID', path: ['chats', 'chat-a', 'branchTree', 'nodes', 'n-inactive', 'id'], value: '"wrong-id"', error: 'Orphaned' },
    { name: 'pinned cyclic parent', path: ['chats', 'chat-a', 'branchTree', 'nodes', 'n-inactive', 'parentId'], value: '"n-inactive"', error: 'Cyclic' },
    { name: 'missing content', path: ['content', wireHashes['n-inactive']], value: null, error: 'Missing or damaged message content' },
    { name: 'missing image asset', path: ['assets', imageAssetId], value: null, error: 'Missing or damaged image' },
    { name: 'missing tree root', path: ['chats', 'chat-a', 'branchTree', 'rootId'], value: '"missing-root"', error: 'Incomplete branch tree' },
    { name: 'missing active node', path: ['chats', 'chat-a', 'branchTree', 'activePath'], value: '["missing-node"]', error: 'Invalid active branch path' },
  ])('still rejects $name with a pinned orphan present', async ({ path, value, error }) => {
    const input = structuredClone(corpus.syncSnapshot);
    const node = input.state.chats![0].branchTree!.nodes['n-inactive'];
    node.pinned = true;
    node.parentId = 'missing-parent';
    const records = await toRecords(input);
    if (value === null) delete records[JSON.stringify(path)];
    else records[JSON.stringify(path)] = value;
    await expect(fromRecords(records)).rejects.toThrow(error);
  });
});

describe('fixed fake crypto and compression wire vectors', () => {
  it('matches LZ-string bytes and restores full corpus from compressed bytes', () => {
    expect(encode({ fake: '日本語' })).toEqual(compressedVector);
    expect(decode(compressedVector)).toEqual({ fake: '日本語' });
    expect(decode(encode(corpus.syncSnapshot))).toEqual(corpus.syncSnapshot);
  });

  it('creates and unlocks the fixed PBKDF2-SHA256/AES-GCM envelope', async () => {
    const subtle = crypto.subtle;
    vi.stubGlobal('crypto', {
      subtle,
      getRandomValues: (array: Uint8Array) => {
        array.set(array.length === 32 ? rawKey : array.length === 16 ? new Uint8Array(envelope.salt) : iv);
        return array;
      },
    });
    const created = await createKeyEnvelope(fakePassword, 'fake-dataset');
    expect(created.envelope).toEqual(envelope);
    const key = await unlockKey(envelope, fakePassword, 'fake-dataset');
    const plain = new TextEncoder().encode('FAKE TEST 日本語');
    expect(await encrypt(key, plain, 'fake-dataset:commit:file-1')).toEqual(ciphertext);
    expect(await decrypt(key, ciphertext, 'fake-dataset:commit:file-1')).toEqual(plain);
    await expect(unlockKey(envelope, fakePassword, 'wrong-fake-dataset')).rejects.toThrow('decrypt');
    await expect(unlockKey({ ...envelope, iterations: 1 }, fakePassword, 'fake-dataset'))
      .rejects.toThrow('Unsupported');
  });

  it('authenticates the ciphertext context and detects damaged bytes', async () => {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    await expect(decrypt(key, ciphertext, 'wrong-fake-context')).rejects.toThrow('decrypt');
    const damaged = ciphertext.slice();
    damaged[damaged.length - 1] ^= 1;
    await expect(decrypt(key, damaged, 'fake-dataset:commit:file-1')).rejects.toThrow('decrypt');
  });
});

describe('CloudKit wire without cloud access', () => {
  it('matches fixed raw UTF-16LE base64 including isolated surrogates', () => {
    const codeUnits = '\ud800\u0000\u00ff\u4e2d\udfff';
    expect(lzStringToBase64(codeUnits)).toBe('ANgAAP8ALU7/3w==');
    expect(base64ToLzString('ANgAAP8ALU7/3w==')).toBe(codeUnits);
    const payload = lzStringToBase64(compress(JSON.stringify(corpus.syncSnapshot)));
    expect(JSON.parse(decompress(base64ToLzString(payload))!)).toEqual(corpus.syncSnapshot);
  });

  it('builds the actual update record with the existing names, field types and change tag', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      records: [{ recordName: 'weavelet-default-snapshot', recordType: 'WeaveletSnapshot', recordChangeTag: 'FAKE_TEST_NEW_TAG' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = lzStringToBase64(compress(JSON.stringify(corpus.syncSnapshot)));
    expect(CLOUDKIT_DEFAULT_RECORD_NAME).toBe('weavelet-default-snapshot');
    const result = await saveCloudKitRecord(
      { containerId: 'iCloud.FAKE_TEST_ONLY', environment: 'development', apiToken: 'FAKE_TEST_ONLY_API_TOKEN' },
      'FAKE_TEST_ONLY_WEB_TOKEN', 'weavelet-default-snapshot', payload, 18,
      'FAKE_TEST_ONLY_DEVICE', 'FAKE_TEST_OLD_TAG', 123456789
    );
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.apple-cloudkit.com/database/1/iCloud.FAKE_TEST_ONLY/development/private/records/modify?ckAPIToken=FAKE_TEST_ONLY_API_TOKEN&ckWebAuthToken=FAKE_TEST_ONLY_WEB_TOKEN');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      operations: [{ operationType: 'update', record: {
        recordType: 'WeaveletSnapshot', recordName: 'weavelet-default-snapshot', recordChangeTag: 'FAKE_TEST_OLD_TAG',
        fields: {
          payload: { value: payload, type: 'BYTES' }, snapshotVersion: { value: 18, type: 'INT64' },
          updatedAt: { value: 123456789, type: 'INT64' }, deviceId: { value: 'FAKE_TEST_ONLY_DEVICE', type: 'STRING' },
        },
      } }],
    });
    expect(result.record.recordChangeTag).toBe('FAKE_TEST_NEW_TAG');
  });
});
