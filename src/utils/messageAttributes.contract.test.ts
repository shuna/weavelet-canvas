import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StoreState } from '@store/store';
import type { ChatInterface, MessageInterface } from '@type/chat';
import type { ContentStoreData } from './contentStore';
const context = vi.hoisted(() => ({ store: null as StoreApi<StoreState> | null, partialize: null as ((state: StoreState) => unknown) | null }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@src/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@store/store', () => ({ default: { getState: () => context.store!.getState(), getInitialState: () => context.store!.getInitialState(), setState: (patch: Partial<StoreState>) => context.store!.setState(patch) }, createPartializedState: (state: StoreState) => context.partialize!(state) }));
import { captureProjectedMessageAttributes, flatMessagesToBranchTree, materializeActivePath, readMessageAttributes } from './branchUtils';
import { ensureBranchTreeState, createBranchState, upsertMessageAtIndexState, upsertWithAutoBranchState, copyBranchSequenceState, pasteBranchSequenceState, deleteBranchState, insertMessageAtIndexState, updateLastNodeContentState } from '@store/branch-domain';
import { prepareChatForExport } from './chatExport';
import { createPartializedState, prepareHydratedState, finishHydratedState } from '@store/persistence';
import { toRecords, fromRecords, hashRecords, diffRecords, applyChanges, type Snapshot } from '@store/storage/google/records';
import { mergeSyncRecords } from '@store/storage/google/merge';
import { replayHistory } from '@store/storage/google/replay';
import { prepareStreamRequest } from '@api/api';
import { importChatFromFile } from '@components/ImportExportChat/importService';
import { createBranchSlice } from '@store/branch-slice';
import { createChatSlice } from '@store/chat-slice';
import { filterOmittedMessages } from '@hooks/submitHelpers';
import { normalizeSystemPrompt } from './systemPromptNormalize';

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/message-attributes.json', import.meta.url), 'utf8'));
const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/io-corpus.json', import.meta.url), 'utf8'));
const flat = (): ChatInterface => structuredClone(fixture.flatChat);
type FixtureSnapshot = Snapshot & { state: { chats: ChatInterface[]; contentStore: ContentStoreData } };
const branched = (): FixtureSnapshot => structuredClone(fixture.branchedSnapshot);
const attributes = (chat: Pick<ChatInterface, 'branchTree'>, id: string) => readMessageAttributes(chat.branchTree!)?.byNode[id];
const ready = () => {
  const source = branched();
  const state = ensureBranchTreeState(source.state.chats!, 0, source.state.contentStore!);
  return { ...source, state: { ...source.state, ...state } };
};
beforeEach(() => {
  context.partialize = createPartializedState;
  context.store = createStore<StoreState>((set) => ({ ...structuredClone(corpus.syncSnapshot.state), chats: [], contentStore: {}, folders: {}, currentChatIndex: -1,
    setChats: (chats: ChatInterface[]) => set({ chats }), setFolders: (folders: StoreState['folders']) => set({ folders }), setCurrentChatIndex: (currentChatIndex: number) => set({ currentChatIndex }),
  } as StoreState));
  vi.stubGlobal('FileReader', class { onload: ((event: { target: { result: string } }) => void) | null = null; readAsText(file: File) { file.text().then(result => this.onload?.({ target: { result } })); } });
});

afterEach(() => vi.unstubAllGlobals());

async function merge(base: Snapshot, local: Snapshot, cloud: Snapshot) {
  return fromRecords(await mergeSyncRecords(await hashRecords(await toRecords(base)), await toRecords(local), await toRecords(cloud)));
}

describe('shared message attributes: external I/O semantics and runtime projection', () => {
  it('converts all unknown flat attributes without overwriting node fields or mutating input', () => {
    const chat = flat(), before = structuredClone(chat), store: ContentStoreData = {};
    const tree = flatMessagesToBranchTree(chat.messages, store);
    for (const [index, id] of tree.activePath.entries()) {
      expect(readMessageAttributes(tree)!.byNode[id]).toEqual(fixture.expected.flatAttributes[index]);
      expect(tree.nodes[id].id).toBe(id);
      expect(tree.nodes[id]).not.toHaveProperty('xFuture');
      expect(tree.nodes[id].label).toBeUndefined();
    }
    expect(materializeActivePath(tree, store)).toEqual(fixture.expected.apiMessages);
    expect(materializeActivePath(tree, store, true)).toEqual(chat.messages);
    expect(chat).toEqual(before);
  });

  it.each(['flat', 'branched'])('imports %s through the actual file service and preserves opaque attributes', async format => {
    const source = format === 'flat' ? flat() : { version: 3, chats: branched().state.chats, contentStore: branched().state.contentStore, folders: {} };
    const before = structuredClone(source);
    expect((await importChatFromFile(new File([JSON.stringify(source)], 'FAKE-message.json'), key => key)).success).toBe(true);
    const chat = context.store!.getState().chats![0];
    expect(chat.messages).toEqual(fixture.expected.apiMessages);
    for (const [index, id] of chat.branchTree!.activePath.entries()) expect(attributes(chat, id)).toEqual(format === 'flat' ? fixture.expected.flatAttributes[index] : fixture.expected.branchedAttributes[id]);
    expect(source).toEqual(before);
  });

  it('keeps projected-only attributes through hydration, compact persistence, export and sync roundtrip', async () => {
    const source = branched(), before = structuredClone(source);
    const saved = createPartializedState({ ...context.store!.getState(), ...source.state } as StoreState);
    expect(saved.chats![0].messages).toBeUndefined();
    expect(saved.chats![0].branchTree!.messageAttributesV1!.byNode).toEqual(fixture.expected.branchedAttributes);
    expect(source).toEqual(before);
    const prepared = await prepareHydratedState(context.store!.getState(), saved);
    context.store!.setState(finishHydratedState(prepared));
    const chat = context.store!.getState().chats![0];
    expect(chat.messages).toEqual(fixture.expected.apiMessages);
    const exported = prepareChatForExport(chat, context.store!.getState().contentStore);
    expect(exported.chat.messages[0]).toEqual({ ...fixture.flatChat.messages[0], xExisting: 'FAKE existing attrs' });
    const restored = await fromRecords(await toRecords({ version: 18, state: saved }));
    expect(restored.state.chats![0].branchTree!.messageAttributesV1!.byNode).toEqual(fixture.expected.branchedAttributes);
    expect(prepareChatForExport(restored.state.chats![0] as ChatInterface, restored.state.contentStore!).chat.messages).toEqual(exported.chat.messages);
  });

  it('retains attributes on content edits, accepts metadata-only updates and stores attributes on inserted messages', () => {
    const source = ready(), chat = source.state.chats![0], before = structuredClone(chat);
    const edited = upsertMessageAtIndexState([chat], 0, 0, { role: 'user', content: fixture.expected.editedContent }, source.state.contentStore!);
    expect(attributes(edited.chats[0], 'a')).toEqual(fixture.expected.branchedAttributes.a);
    expect(edited.chats[0].messages[0]).toEqual({ role: 'user', content: fixture.expected.editedContent });
    const metadataOnly = upsertWithAutoBranchState(edited.chats, 0, 0, { ...edited.chats[0].messages[0], xAdded: { future: true } } as MessageInterface, edited.contentStore);
    expect(metadataOnly.noOp).not.toBe(true);
    expect(attributes(metadataOnly.chats[0], 'a')).toEqual({ ...fixture.expected.branchedAttributes.a, xAdded: { future: true } });
    const inserted = insertMessageAtIndexState(metadataOnly.chats, 0, 1, fixture.flatChat.messages[1], metadataOnly.contentStore);
    expect(attributes(inserted.chats[0], inserted.newId)).toEqual(fixture.expected.flatAttributes[1]);
    const last = updateLastNodeContentState(inserted.chats, 0, fixture.expected.editedContent, inserted.contentStore);
    expect(attributes(last.chats[0], 'b')).toEqual(fixture.expected.branchedAttributes.b);
    expect(chat).toEqual(before);
  });

  it('copies message attributes to new branches without inheriting node metadata, and copies clipboard maps independently', () => {
    const source = ready(), chat = source.state.chats![0], before = structuredClone(chat);
    const branch = createBranchState([chat], 0, 'a', fixture.expected.editedContent, source.state.contentStore!);
    expect(attributes(branch.chats[0], branch.newId)).toEqual(fixture.expected.branchedAttributes.a);
    const node = branch.chats[0].branchTree!.nodes[branch.newId];
    for (const field of ['label', 'starred', 'pinned', 'xNode']) expect(node).not.toHaveProperty(field);
    expect(chat).toEqual(before);
    const clipboard = copyBranchSequenceState([chat], 0, 'a', 'b')!;
    expect(readMessageAttributes(clipboard)!.byNode).toEqual(fixture.expected.branchedAttributes);
    const pasted = pasteBranchSequenceState([chat], 0, 'b', clipboard, source.state.contentStore!);
    for (const [index, id] of pasted.chats[0].branchTree!.activePath.slice(-2).entries()) expect(attributes(pasted.chats[0], id)).toEqual(index === 0 ? fixture.expected.branchedAttributes.a : fixture.expected.branchedAttributes.b);
    (attributes(pasted.chats[0], pasted.chats[0].branchTree!.activePath.at(-2)!)!.xFuture as any).nested[1].flag = false;
    expect(clipboard.messageAttributesV1!.byNode.a).toEqual(fixture.expected.branchedAttributes.a);
    expect(attributes(chat, 'a')).toEqual(fixture.expected.branchedAttributes.a);
  });

  it('retains clipboard attributes through actual sync and removes only deleted/filtered nodes', async () => {
    const source = ready(), chat = source.state.chats![0];
    const clipboard = copyBranchSequenceState([chat], 0, 'a', 'b')!;
    const restored = await fromRecords(await toRecords({ ...source, state: { ...source.state, branchClipboard: clipboard } }));
    expect(restored.state.branchClipboard!.messageAttributesV1!.byNode).toEqual(fixture.expected.branchedAttributes);
    const branchedState = createBranchState([chat], 0, 'b', fixture.expected.editedContent, source.state.contentStore!);
    const visible = prepareChatForExport(branchedState.chats[0], branchedState.contentStore, { visibleBranchOnly: true });
    expect(visible.chat.branchTree!.messageAttributesV1!.byNode).not.toHaveProperty('b');
    const deleted = deleteBranchState(branchedState.chats, 0, branchedState.newId, branchedState.contentStore);
    expect(attributes(deleted.chats[0], branchedState.newId)).toBeUndefined();
    expect(attributes(deleted.chats[0], 'b')).toEqual(fixture.expected.branchedAttributes.b);
  });

  it('preserves both equal-body/different-message-attribute branches and moves attributes with chat copies', async () => {
    const base = ready(), local = structuredClone(base), cloud = structuredClone(base);
    local.state.chats![0].branchTree!.messageAttributesV1!.byNode.b.xVariant = 'FAKE local';
    cloud.state.chats![0].branchTree!.messageAttributesV1!.byNode.b.xVariant = 'FAKE cloud';
    const merged = await merge(base, local, cloud);
    const alternatives = Object.values(merged.state.chats![0].branchTree!.nodes).filter(node => node.parentId === 'a');
    expect(alternatives).toHaveLength(2);
    expect(alternatives.map(node => attributes(merged.state.chats![0], node.id)?.xVariant)).toEqual(expect.arrayContaining(['FAKE local', 'FAKE cloud']));
    local.state.chats![0].title = 'FAKE local'; cloud.state.chats![0].title = 'FAKE cloud';
    const copied = await merge(base, local, cloud);
    expect(copied.state.chats).toHaveLength(2);
    for (const chat of copied.state.chats!) expect(attributes(chat, 'b')!.xVariant).toBe(chat.title);
  });

  it('replays independent node attributes without a whole-map conflict', async () => {
    const base = ready(), local = structuredClone(base), cloud = structuredClone(base);
    local.state.chats![0].branchTree!.messageAttributesV1!.byNode.a.xVariant = 'FAKE local';
    cloud.state.chats![0].branchTree!.messageAttributesV1!.byNode.b.xVariant = 'FAKE cloud';
    const b = await toRecords(base), l = await toRecords(local), c = await toRecords(cloud);
    const commits = { base: { version: 1 as const, parents: [], changes: await diffRecords({}, b) }, local: { version: 1 as const, parents: ['base'], changes: await diffRecords(b, l) }, cloud: { version: 1 as const, parents: ['base'], changes: await diffRecords(b, c) } };
    const merged = await replayHistory({ commits, tips: ['local', 'cloud'] });
    expect(merged.conflicts).toEqual({});
    const result = await fromRecords(merged.records);
    expect(attributes(result.state.chats![0], 'a')!.xVariant).toBe('FAKE local');
    expect(attributes(result.state.chats![0], 'b')!.xVariant).toBe('FAKE cloud');
    expect(await fromRecords(await applyChanges(c, await diffRecords(b, l)))).toEqual(result);
  });

  it.each(['namespace', 'mismatch', 'conflict'])('rejects %s non-destructively only when opaque projection information exists', async scenario => {
    const source = branched(), chat = source.state.chats![0];
    if (scenario === 'namespace') (chat.branchTree as any).messageAttributesV1 = { futureUnknown: 'FAKE occupied' };
    if (scenario === 'mismatch') chat.messages[0].content = [{ type: 'text', text: 'FAKE unmatched' }];
    if (scenario === 'conflict') chat.branchTree!.messageAttributesV1!.byNode.a.id = 'FAKE conflicting value';
    const before = structuredClone(source);
    expect(() => captureProjectedMessageAttributes(chat, source.state.contentStore!)).toThrow();
    expect(source).toEqual(before);
    const liveBefore = createPartializedState(context.store!.getState());
    expect((await importChatFromFile(new File([JSON.stringify({ version: 3, chats: [chat], contentStore: source.state.contentStore, folders: {} })], 'FAKE-invalid.json'), key => key)).success).toBe(false);
    expect(createPartializedState(context.store!.getState())).toEqual(liveBefore);
    if (scenario === 'mismatch') {
      const ordinary = branched();
      ordinary.state.chats![0].messages = [{ role: 'assistant', content: [] }];
      expect(() => captureProjectedMessageAttributes(ordinary.state.chats![0], ordinary.state.contentStore!)).not.toThrow();
    }
  });

  it('remaps flat numeric maps with runtime priority and retains omitted/protected semantics for save and send', () => {
    const chat = flat(), before = structuredClone(chat);
    const domain = ensureBranchTreeState([chat], 0, {});
    const ids = domain.chats[0].branchTree!.activePath;
    expect(domain.chats[0].omittedNodes).toEqual({ [ids[0]]: true });
    expect(domain.chats[0].protectedNodes).toEqual({ [ids[0]]: true });
    expect(domain.chats[0].collapsedNodes).toEqual({ [ids[1]]: true, 'FAKE-existing-uuid': false, '01': false });
    expect(chat).toEqual(before);
    context.store = createStore<StoreState>((set, get) => ({ ...structuredClone(corpus.syncSnapshot.state), ...createChatSlice(set, get), ...createBranchSlice(set, get),
      chats: [flat()], contentStore: {}, generatingSessions: {}, collapsedNodeMaps: { '0': { '0': false } }, omittedNodeMaps: { '0': { '0': true } }, protectedNodeMaps: { '0': { '0': true } },
    } as StoreState));
    context.store.getState().ensureBranchTree(0);
    const state = context.store.getState(), converted = state.chats![0], id = converted.branchTree!.activePath[0];
    expect(state.omittedNodeMaps['0']).toEqual({ [id]: true });
    expect(state.protectedNodeMaps['0']).toEqual({ [id]: true });
    expect(state.collapsedNodeMaps['0']).toEqual({ [id]: false });
    expect(filterOmittedMessages(converted.messages, 0)).toEqual([fixture.expected.apiMessages[1]]);
    expect(createPartializedState(state).chats![0].omittedNodes).toEqual({ [id]: true });
    const tree = structuredClone(converted.branchTree);
    state.upsertWithAutoBranch(0, 0, 'user', fixture.expected.editedContent);
    expect(context.store.getState().chats![0].branchTree).toEqual(tree);
  });

  it('never sends stored message attributes to the LLM provider', () => {
    const { body } = prepareStreamRequest('https://FAKE.example.invalid/chat/completions', fixture.flatChat.messages, fixture.flatChat.config);
    expect((body as { messages: unknown }).messages).toEqual(fixture.expected.apiMessages);
    expect(JSON.stringify(body)).not.toContain('foreign');
    expect(JSON.stringify(body)).not.toContain('xFuture');
  });

  it('preserves system-message attributes while normalizing system prompts', () => {
    const chat = flat(), store: ContentStoreData = {};
    chat.messages[0].role = 'system';
    normalizeSystemPrompt(chat, store);
    expect(chat.config.systemPrompt).toBe('FAKE TEST first');
    expect(attributes(chat, chat.branchTree!.activePath[0])).toEqual(fixture.expected.flatAttributes[0]);
    expect(chat.messages[0]).not.toHaveProperty('xFuture');
  });
});
