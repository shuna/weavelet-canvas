import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
let webIDs: string[] = [];
vi.mock('uuid', () => ({ v4: () => webIDs.shift() ?? editingUUID() }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
import { editingUUID, messageEdit } from '../../shared/google-sync/editing';
import { resolveContent, addContent, addContentDelta, computeContentHash, isContentEqual } from '../utils/contentStore';
import { toRecords, fromRecords } from './storage/google/records';
import { materializeActivePath } from '../utils/branchUtils';
import { createChatSlice } from './chat-slice';
import { createBranchSlice } from './branch-slice';
import { recordChatEdits } from './chat-edit-time';
import { getAppliedBubbleSummaries } from '../utils/bubbleSummary';
import type { StoreApi } from 'zustand';
import type { StoreState } from './store';
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/message-editing.json', import.meta.url), 'utf8'));
function apply(source: any, changes: any[]) {
  const root = structuredClone(source);
  for (const change of changes) {
    let parent = root;
    for (const key of change.path.slice(0, -1)) parent = parent[key];
    const key = change.path.at(-1);
    if (change.op === 'set') parent[key] = change.value;
    else if (change.op === 'remove') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
    else {
      const current = change.path.length ? parent[key] : root;
      const values = change.keys.map((key: string) => [key, current[key]]);
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, Object.fromEntries(values));
    }
  }
  return root;
}
function snapshot(input: any) {
  const source = structuredClone(input), store = source.contentStore;
  delete source.contentStore;
  for (const chat of source.chats) if (chat.branchTree) for (const node of Object.values(chat.branchTree.nodes) as any[]) {
    node.content = resolveContent(store, node.contentHash); delete node.contentHash;
  }
  return source;
}
describe('native editing adapter calls the actual Web domain', () => {
  for (const item of fixture.cases) it(item.name, () => {
    const input = structuredClone(item.input), before = structuredClone(input);
    const changes = JSON.parse(messageEdit(JSON.stringify({ chat: input.chats[0], contentStore: input.contentStore,
      nodeID: item.nodeID, viewingPath: item.input.chats[0].branchTree?.activePath ?? [], role: item.role, parts: item.parts, mode: item.mode, newIDs: item.newIDs, now: item.now })));
    const output = apply({ chat: input.chats[0], contentStore: input.contentStore }, changes);
    const source = { ...input, chats: [output.chat, ...input.chats.slice(1)], contentStore: output.contentStore };
    expect(snapshot(source)).toEqual(item.expected);
    expect(input).toEqual(before);
    expect(materializeActivePath(output.chat.branchTree, output.contentStore).every(message => Object.keys(message).every(key => key === 'role' || key === 'content'))).toBe(true);
  });
  it('applies the extracted Web text rule once at save and preserves all other parts and source values', () => {
    const item = fixture.cases[0], input = structuredClone(item.input);
    const parts = [{ type: 'reasoning', text: 'reason' }, { type: 'text', text: 'old', xFuture: { opaqueRef: 0 } }, { type: 'text', text: 'second' }];
    const before = structuredClone({ input, parts });
    expect(JSON.parse(messageEdit(JSON.stringify({ operation: 'textValue', parts })))).toBe('old');
    const output = apply({ chat: input.chats[0], contentStore: input.contentStore }, JSON.parse(messageEdit(JSON.stringify({
      chat: input.chats[0], contentStore: input.contentStore, parts, editedText: 'edited', nodeID: 'middle',
      viewingPath: ['system', 'middle', 'last'], role: 'user', mode: 'overwrite', newIDs: [], now: 1000,
    }))));
    expect(resolveContent(output.contentStore, output.chat.branchTree.nodes.middle.contentHash)).toEqual([
      parts[0], { ...parts[1], text: 'edited' }, parts[2],
    ]);
    expect({ input, parts }).toEqual(before);
  });

  it('uses the existing Web append validation after shared draft replacement, including later text parts', () => {
    const item = fixture.cases.find((item: any) => item.name === 'empty-append');
    const input = { chat: item.input.chats[0], contentStore: item.input.contentStore, role: 'user', mode: 'append', viewingPath: [], newIDs: ['new-node'], now: 1000 };
    expect(() => messageEdit(JSON.stringify({ ...input, parts: [{ type: 'text', text: '' }], editedText: '  ' }))).toThrow('本文を入力してください');
    const changes = JSON.parse(messageEdit(JSON.stringify({ ...input, parts: [{ type: 'text', text: 'old' }, { type: 'text', text: 'second' }], editedText: '' })));
    const output = apply({ chat: input.chat, contentStore: input.contentStore }, changes);
    expect(resolveContent(output.contentStore, output.chat.branchTree.nodes['new-node'].contentHash)).toEqual([{ type: 'text', text: '' }, { type: 'text', text: 'second' }]);
  });

  it.each(['middle-overwrite-retains-descendants-and-all-parts', 'flat-overwrite'])('agrees with the current NodeTarget save and Web edit timestamps for %s', name => {
    const item = fixture.cases.find((item: any) => item.name === name);
    const input = structuredClone(item.input);
    const nodeID = name === 'flat-overwrite' ? '0' : 'middle';
    const output = apply({ chat: input.chats[0], contentStore: input.contentStore }, JSON.parse(messageEdit(JSON.stringify({
      chat: input.chats[0], contentStore: input.contentStore, nodeID, viewingPath: input.chats[0].branchTree?.activePath ?? [],
      role: item.role, parts: item.parts, mode: 'overwrite', newIDs: item.newIDs, now: 1000,
    }))));
    let state: StoreState;
    const get = () => state;
    const set = ((partial: unknown) => { state = { ...state, ...(typeof partial === 'function' ? (partial as any)(state) : partial) }; }) as StoreApi<StoreState>['setState'];
    const other = { ...structuredClone(input.chats[0]), id: 'unrelated' };
    state = { ...createChatSlice(set, get), ...createBranchSlice(set, get), chats: [other, input.chats[0]], contentStore: input.contentStore } as StoreState;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    webIDs = [...item.newIDs];
    try {
      expect(state.saveNode({ chatId: input.chats[0].id, nodeId: nodeID, role: item.role, content: item.parts })).toEqual({ status: 'updated' });
      const recorded = recordChatEdits(input.chats, [output.chat], 1000);
      expect(state.chats![1]).toEqual(recorded.chats[0]);
      expect(state.contentStore).toEqual(output.contentStore);
      // The current slice materializes optional runtime maps on flat chats.
      // Assert every original value remains and no edit stamp is added.
      expect(state.chats![0]).toEqual({ ...other, collapsedNodes: other.collapsedNodes, omittedNodes: other.omittedNodes, protectedNodes: other.protectedNodes });
      expect(state.lastContentEditedAt).toBe(1000);
    } finally { clock.mockRestore(); webIDs = []; }
  });

  it.each(['text-tail', 'opaque-attribute'])('returns full new content before opaque restoration for a beneficial %s delta', async change => {
    const item = fixture.cases.find((item: any) => item.name === 'last-overwrite');
    const chat = structuredClone(item.input.chats[0]);
    const base = [{ type: 'text', text: 'Long text '.repeat(300), xFuture: { opaqueRef: 0 } }];
    const parts = structuredClone(base);
    if (change === 'text-tail') parts[0].text += 'Edited';
    else parts[0].xFuture = { opaqueRef: 1 };
    const store: any = { ...structuredClone(item.input.contentStore), base: { content: base, refCount: 2, xEntry: { opaqueRef: 2 } } };
    // Two nodes own the base so releasing the edited node cannot promote the delta.
    const oldHash = chat.branchTree.nodes.last.contentHash;
    store[oldHash] = store.base;
    delete store.base;
    chat.branchTree.nodes.inactive = { id: 'inactive', parentId: null, role: 'assistant', contentHash: oldHash, createdAt: 0 };
    const probe = structuredClone(store);
    expect(probe[addContentDelta(probe, parts as any, oldHash)].delta).toBeDefined();
    const before = structuredClone({ chat, contentStore: store });
    const output = apply(before, JSON.parse(messageEdit(JSON.stringify({ chat, contentStore: store, nodeID: 'last',
      viewingPath: chat.branchTree.activePath, role: 'assistant', parts, mode: 'overwrite', newIDs: [], now: 1000 }))));
    const hash = output.chat.branchTree.nodes.last.contentHash;
    expect(output.contentStore[hash].delta).toBeUndefined();
    expect(output.contentStore[hash].content).toEqual(parts);
    expect(output.contentStore[oldHash].content).toEqual(base);
    expect({ chat, contentStore: store }).toEqual(before);
    const opaque = [{ exact: ['old', 'metadata'] }, { exact: ['new', 'metadata'] }, { owner: 'entry' }];
    const restore = (value: any): any => {
      if (value && !Array.isArray(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'opaqueRef')) return structuredClone(opaque[value.opaqueRef]);
      if (Array.isArray(value)) return value.map(restore);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]));
      return value;
    };
    const raw = restore(output), rawParts = restore(parts);
    // Store keys are opaque reference IDs, not a claim that raw FNV hashes match.
    expect(hash).not.toBe(computeContentHash(rawParts));
    expect(isContentEqual(raw.contentStore, hash, rawParts)).toBe(true);
    expect(resolveContent(raw.contentStore, hash)).toEqual(rawParts);
    const hashOnNextWebWrite = addContent(raw.contentStore, rawParts);
    expect(resolveContent(raw.contentStore, hashOnNextWebWrite)).toEqual(rawParts);
    expect(resolveContent(raw.contentStore, hash)).toEqual(rawParts);
    const restored = await fromRecords(await toRecords({ version: 18, state: { chats: [raw.chat], contentStore: raw.contentStore } } as any));
    const syncedChat = restored.state.chats![0];
    expect(resolveContent(restored.state.contentStore!, syncedChat.branchTree!.nodes.last.contentHash)).toEqual(rawParts);
    expect(resolveContent(restored.state.contentStore!, syncedChat.branchTree!.nodes.inactive.contentHash)).toEqual(restore(base));
  });

  it('keeps summary/capsule data while the actual Web summary rule rejects stale source text after edit', () => {
    const item = fixture.cases.find((item: any) => item.name === 'last-overwrite');
    const input = structuredClone(item.input);
    input.chats[0].summaries = [{ id: 'summary', mode: 'single', text: 'Capsule', useForSubmit: true,
      sources: [{ nodeId: 'last', parentId: 'middle', role: 'assistant', textParts: ['Last'] }], xFuture: { keep: ['one', 'two'] } }];
    input.chats[0].summaryTargets = { last: true };
    expect(getAppliedBubbleSummaries(input.chats[0])).toHaveLength(1);
    const output = apply({ chat: input.chats[0], contentStore: input.contentStore }, JSON.parse(messageEdit(JSON.stringify({
      chat: input.chats[0], contentStore: input.contentStore, nodeID: 'last', viewingPath: input.chats[0].branchTree.activePath,
      role: item.role, parts: item.parts, mode: 'overwrite', newIDs: [], now: 1000,
    }))));
    expect(output.chat.summaries).toEqual(input.chats[0].summaries);
    expect(output.chat.summaryTargets).toEqual({ last: true });
    expect(getAppliedBubbleSummaries(output.chat)).toEqual([]);
  });

});
