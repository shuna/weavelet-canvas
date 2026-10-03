import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { createBranchSlice } from './branch-slice';
import { createChatSlice } from './chat-slice';
import type { StoreState } from './store';
import type { ChatInterface } from '@type/chat';
import { addContent, resolveContent } from '@utils/contentStore';

const content = (text: string) => [{ type: 'text' as const, text }];
const messageTexts = (value: ChatInterface) => value.messages.map((message) => {
  const first = message.content[0];
  return first?.type === 'text' ? first.text : '';
});

const chat = (id: string, text: string): ChatInterface => ({
  id,
  title: id,
  titleSet: true,
  config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  imageDetail: 'auto',
  messages: [{ role: 'user', content: content(text) }],
});

const makeState = () => {
  let state: StoreState;
  const get = () => state;
  const set = ((partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (value: StoreState) => Partial<StoreState>)(state)
      : partial as Partial<StoreState>;
    state = {
      ...state,
      ...patch,
    };
  }) as StoreApi<StoreState>['setState'];
  state = { ...createChatSlice(set, get), ...createBranchSlice(set, get) } as StoreState;
  return get;
};

describe('branch history scope', () => {
  it('restores only the edited chat and preserves unrelated chat and folded state', () => {
    const get = makeState();
    get().setChats([chat('a', 'before'), chat('b', 'other')]);
    get().upsertMessageAtIndex(0, 0, 'user', content('after'));
    const nodeId = get().chats![0].branchTree!.rootId;
    get().toggleCollapseNode(0, 0);
    get().toggleOmitNode(0, 0);
    get().toggleProtectNode(0, 0);
    const renamed = get().chats!.slice();
    renamed[0] = {
      ...renamed[0],
      title: 'current title',
      config: { ...renamed[0].config, temperature: 0.25 },
    };
    get().setChats(renamed);
    get().setChats([...get().chats!, chat('c', 'later')]);

    get().undoBranch();

    expect(get().chats?.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(get().chats?.[0].messages[0].content).toEqual(content('before'));
    expect(get().chats?.[0].title).toBe('current title');
    expect(get().chats?.[0].config.temperature).toBe(0.25);
    expect(get().chats?.[0].collapsedNodes).toEqual({ [nodeId]: true });
    expect(get().chats?.[0].omittedNodes).toEqual({ [nodeId]: true });
    expect(get().chats?.[0].protectedNodes).toEqual({ [nodeId]: true });
    expect(get().collapsedNodeMaps['0']).toEqual({ [nodeId]: true });
    expect(get().omittedNodeMaps['0']).toEqual({ [nodeId]: true });
    expect(get().protectedNodeMaps['0']).toEqual({ [nodeId]: true });
  });

  it('does not record path switches and clears redo after a new edit', () => {
    const get = makeState();
    get().setChats([chat('a', 'before')]);
    get().upsertMessageAtIndex(0, 0, 'user', content('after'));
    const path = get().chats![0].branchTree!.activePath.slice();
    get().switchActivePath(0, path);
    expect(get().branchHistoryPast).toHaveLength(1);

    get().undoBranch();
    expect(get().canRedoBranch()).toBe(true);
    get().upsertMessageAtIndex(0, 0, 'user', content('new'));
    expect(get().canRedoBranch()).toBe(false);
  });

  it('invalidates a chat history before generated or imported content can be restored', () => {
    const get = makeState();
    get().setChats([chat('a', 'before')]);
    get().upsertMessageAtIndex(0, 0, 'user', content('saved'));
    get().invalidateBranchHistory(['a']);
    expect(get().canUndoBranch()).toBe(false);

    get().upsertMessageAtIndex(0, 0, 'user', content('saved again'));
    get().addSession({
      sessionId: 's', chatId: 'a', chatIndex: 0, messageIndex: 0, targetNodeId: 'n',
      mode: 'append', insertIndex: null, requestPath: 'fetch', startedAt: 1,
    });
    expect(get().canUndoBranch()).toBe(false);
    get().undoBranch();
    expect(get().chats?.[0].messages[0].content).toEqual(content('saved again'));
  });

  it('invalidates only an imported chat and leaves another chat history undoable', () => {
    const get = makeState();
    get().setChats([chat('a', 'before a'), chat('b', 'before b')]);
    get().upsertMessageAtIndex(0, 0, 'user', content('saved a'));
    get().upsertMessageAtIndex(1, 0, 'user', content('saved b'));
    const imported = get().chats!.slice();
    imported[0] = structuredClone(imported[0]);
    const store = { ...get().contentStore };
    const hash = addContent(store, content('generated a'));
    const tree = imported[0].branchTree!;
    tree.nodes[tree.rootId].contentHash = hash;
    imported[0].messages = [{ role: 'user', content: content('generated a') }];
    get().setContentStore(store);
    get().setChats(imported);

    get().undoBranch();

    expect(messageTexts(get().chats![0])).toEqual(['generated a']);
    expect(messageTexts(get().chats![1])).toEqual(['before b']);
  });

  it('invalidates history for a system-prompt tree update and keeps the prompt', () => {
    const get = makeState();
    get().setChats([chat('a', 'before')]);
    get().upsertMessageAtIndex(0, 0, 'user', content('saved'));
    get().setChatSystemPrompt(0, 'new prompt');

    expect(get().canUndoBranch()).toBe(false);
    get().undoBranch();
    expect(get().chats?.[0].config.systemPrompt).toBe('new prompt');
  });

  it('keeps a later branch selection while undo restores the edited node', () => {
    const get = makeState();
    get().setChats([chat('a', 'before')]);
    get().ensureBranchTree(0);
    const rootId = get().chats![0].branchTree!.rootId;
    const otherId = get().createBranch(0, rootId, content('other'));
    get().invalidateBranchHistory(['a']);
    get().switchActivePath(0, [rootId]);
    get().upsertMessageAtIndex(0, 0, 'user', content('edited'));
    get().switchActivePath(0, [otherId]);

    get().undoBranch();

    expect(messageTexts(get().chats![0])).toEqual(['other']);
    expect(resolveContent(get().contentStore, get().chats![0].branchTree!.nodes[rootId].contentHash)).toEqual(content('before'));
  });

  it('records a cross-chat move as one undo operation', () => {
    const get = makeState();
    get().setChats([chat('a', 'source'), chat('b', 'target')]);
    get().ensureBranchTree(0);
    get().ensureBranchTree(1);
    get().appendNodeToActivePath(0, 'assistant', content('moved'));
    get().invalidateBranchHistory(['a', 'b']);
    const sourceNodeId = get().chats![0].branchTree!.activePath[1];
    const targetNodeId = get().chats![1].branchTree!.rootId;

    get().moveBranchSequence(0, sourceNodeId, sourceNodeId, 1, targetNodeId);

    expect(get().branchHistoryPast).toHaveLength(1);
    get().undoBranch();
    expect(get().chats?.[0].messages).toHaveLength(2);
    expect(get().chats?.[1].messages).toHaveLength(1);
  });

  it('restores insert, delete, and order changes through undo and redo', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    get().ensureBranchTree(0);
    get().insertMessageAtIndex(0, 1, 'assistant', content('two'));
    expect(messageTexts(get().chats![0])).toEqual(['one', 'two']);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one']);
    get().redoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one', 'two']);

    get().removeMessageAtIndex(0, 1);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one', 'two']);
    get().redoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one']);

    get().appendNodeToActivePath(0, 'assistant', content('two'));
    get().appendNodeToActivePath(0, 'assistant', content('three'));
    get().moveMessage(0, 1, 'down');
    expect(messageTexts(get().chats![0])).toEqual(['one', 'three', 'two']);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one', 'two', 'three']);
    get().redoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one', 'three', 'two']);
  });

  it('keeps shared refcounts and restores missing delta bases', () => {
    const get = makeState();
    const base = 'base '.repeat(100);
    get().setChats([chat('a', base), chat('b', base)]);
    get().ensureBranchTree(0);
    get().ensureBranchTree(1);
    const baseHash = get().chats![0].branchTree!.rootId;
    const sharedHash = get().chats![0].branchTree!.nodes[baseHash].contentHash;
    get().upsertMessageAtIndex(0, 0, 'user', content(`${base}changed`));
    const deltaHash = get().chats![0].branchTree!.nodes[baseHash].contentHash;
    get().setChats([...get().chats!, chat('c', base)]);
    get().ensureBranchTree(2);

    get().undoBranch();
    expect(get().contentStore[sharedHash].refCount).toBe(2);

    const missing = { ...get().contentStore };
    delete missing[sharedHash];
    delete missing[deltaHash];
    get().setContentStore(missing);
    get().redoBranch();
    expect(get().contentStore[deltaHash]?.delta?.baseHash).toBe(sharedHash);
    expect(get().contentStore[sharedHash]).toBeDefined();
  });
});
