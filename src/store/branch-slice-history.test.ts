import { describe, expect, it, vi } from 'vitest';
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
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

const makeState = (onSet?: (state: StoreState) => void) => {
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
    onSet?.(state);
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
    get().setNodeCollapsed({ chatId: get().chats![0].id, nodeId: get().chats![0].branchTree?.activePath[0] ?? '0', value: true });
    get().setNodeOmitted({ chatId: get().chats![0].id, nodeId: get().chats![0].branchTree?.activePath[0] ?? '0', value: true });
    get().setNodeProtected({ chatId: get().chats![0].id, nodeId: get().chats![0].branchTree?.activePath[0] ?? '0', value: true });
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
    get().setChatSystemPrompt({ chatId: 'a', prompt: 'new prompt' });

    expect(get().canUndoBranch()).toBe(false);
    get().undoBranch();
    expect(get().chats?.[0].config.systemPrompt).toBe('new prompt');
  });

  it('keeps a later branch selection while undo restores the edited node', () => {
    const get = makeState();
    get().setChats([chat('a', 'before')]);
    get().ensureBranchTree(0);
    const rootId = get().chats![0].branchTree!.rootId;
    const branch = get().createBranch({ chatId: 'a', fromNodeId: rootId, content: content('other') });
    if (branch.status !== 'created') throw new Error('branch failed');
    const otherId = branch.nodeId;
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
    get().appendNode({ chatId: 'a', role: 'assistant', content: content('moved') });
    get().invalidateBranchHistory(['a', 'b']);
    const sourceNodeId = get().chats![0].branchTree!.activePath[1];
    const targetNodeId = get().chats![1].branchTree!.rootId;

    get().moveBranchSequence({ sourceChatId: 'a', fromNodeId: sourceNodeId, toNodeId: sourceNodeId, targetChatId: 'b', afterNodeId: targetNodeId });

    expect(get().branchHistoryPast).toHaveLength(1);
    get().undoBranch();
    expect(get().chats?.[0].messages).toHaveLength(2);
    expect(get().chats?.[1].messages).toHaveLength(1);
  });

  it('restores insert, delete, and order changes through undo and redo', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    get().ensureBranchTree(0);
    get().insertNode({ chatId: 'a', beforeNodeId: null, role: 'assistant', content: content('two') });
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

    get().appendNode({ chatId: 'a', role: 'assistant', content: content('two') });
    get().appendNode({ chatId: 'a', role: 'assistant', content: content('three') });
    get().moveNode({ chatId: 'a', nodeId: get().chats![0].branchTree!.activePath[1], direction: 'down' });
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


describe('message editing boundaries', () => {
  it('synchronizes system configuration for role-only changes and explicit root branches', () => {
    const get = makeState();
    get().setChats([chat('a', 'before')]);
    get().updateNodeRole({ chatId: 'a', nodeId: '0', role: 'system' });
    const root = get().chats![0].branchTree!.rootId;
    expect(get().chats![0].config.systemPrompt).toBe('before');
    get().createBranch({ chatId: 'a', fromNodeId: root, content: content('branched system') });
    const current = get().chats![0];
    expect(current.config.systemPrompt).toBe('branched system');
    expect(resolveContent(get().contentStore, current.branchTree!.nodes[root].contentHash)).toEqual(content('before'));
    get().updateNodeRole({ chatId: 'a', nodeId: current.branchTree!.activePath[0], role: 'user' });
    expect(get().chats![0].config.systemPrompt).toBeUndefined();
  });
});

describe('range operations and prompt history', () => {
  const rangeState = () => {
    const writes: StoreState[] = [];
    const get = makeState((state) => writes.push(state));
    get().setChats([chat('a', 'root'), chat('b', 'target')]);
    get().ensureBranchTree(0);
    get().ensureBranchTree(1);
    const root = get().chats![0].branchTree!.rootId;
    const middleResult = get().appendNode({ chatId: 'a', role: 'assistant', content: content('middle') });
    if (middleResult.status !== 'updated') throw new Error('append failed');
    const middle = middleResult.nodeId;
    const leafResult = get().appendNode({ chatId: 'a', role: 'user', content: content('leaf') });
    if (leafResult.status !== 'updated') throw new Error('append failed');
    const leaf = leafResult.nodeId;
    const branch = get().createBranch({ chatId: 'a', fromNodeId: leaf, content: content('other') });
    if (branch.status !== 'created') throw new Error('branch failed');
    const other = branch.nodeId;
    get().switchActivePath(0, [root, middle, leaf]);
    get().invalidateBranchHistory(['a', 'b']);
    writes.length = 0;
    return { get, root, middle, leaf, other, writes };
  };

  it('cuts only the range and exposes clipboard and tree together', () => {
    const { get, root, middle, leaf, other, writes } = rangeState();
    const result = get().cutBranchSequence({ chatId: 'a', fromNodeId: root, toNodeId: middle });
    expect(result.status).toBe('cut');
    expect(writes).toHaveLength(1);
    expect(writes[0].branchClipboard?.nodeIds).toEqual([root, middle]);
    expect(writes[0].chats![0].branchTree!.nodes[root]).toBeUndefined();
    const tree = get().chats![0].branchTree!;
    expect(Object.keys(tree.nodes)).toEqual([leaf, other]);
    expect(tree.nodes[leaf].parentId).toBeNull();
    expect(tree.nodes[other].parentId).toBeNull();
    expect(tree.activePath).toEqual([leaf]);
    expect(get().branchClipboard?.nodeIds).toEqual([root, middle]);
    expect(get().branchHistoryPast).toHaveLength(1);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['root', 'middle', 'leaf']);
    expect(get().branchClipboard?.nodeIds).toEqual([root, middle]);
    get().redoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['leaf']);
  });

  it('rejects invalid ranges, destinations and missing contents without changing any state', () => {
    const { get, root, middle, leaf, other } = rangeState();
    get().copyBranchSequence({ chatId: 'a', fromNodeId: root, toNodeId: leaf });
    const before = get();
    expect(get().cutBranchSequence({ chatId: 'a', fromNodeId: leaf, toNodeId: other }).status).toBe('not-ancestor');
    expect(get()).toBe(before);
    expect(get().cutBranchSequence({ chatId: 'a', fromNodeId: 'missing', toNodeId: middle }).status).toBe('missing');
    expect(get()).toBe(before);
    expect(get().moveBranchSequence({ sourceChatId: 'a', fromNodeId: root, toNodeId: middle, targetChatId: 'a', afterNodeId: middle }).status).toBe('invalid-target');
    expect(get()).toBe(before);
    const missingHash = before.chats![0].branchTree!.nodes[middle].contentHash;
    const damaged = { ...before.contentStore };
    delete damaged[missingHash];
    get().setContentStore(damaged);
    const withMissingContent = get();
    expect(get().cutBranchSequence({ chatId: 'a', fromNodeId: root, toNodeId: middle }).status).toBe('content-missing');
    expect(get().pasteBranchSequence({ chatId: 'b', afterNodeId: get().chats![1].branchTree!.rootId }).status).toBe('content-missing');
    expect(get()).toBe(withMissingContent);
    damaged[missingHash] = { content: [], refCount: 1, delta: { baseHash: 'missing-base', patches: '' } };
    expect(get().cutBranchSequence({ chatId: 'a', fromNodeId: root, toNodeId: middle }).status).toBe('content-missing');
    expect(get()).toBe(withMissingContent);
  });

  it('moves a finite range across chats as one undo while retaining unselected children', () => {
    const { get, root, middle, leaf, other } = rangeState();
    const target = get().chats![1].branchTree!.rootId;
    const result = get().moveBranchSequence({ sourceChatId: 'a', fromNodeId: middle, toNodeId: middle, targetChatId: 'b', afterNodeId: target });
    expect(result.status).toBe('moved');
    expect(get().chats![0].branchTree!.nodes[leaf].parentId).toBe(root);
    expect(get().chats![0].branchTree!.nodes[other].parentId).toBe(root);
    expect(messageTexts(get().chats![0])).toEqual(['root', 'leaf']);
    expect(messageTexts(get().chats![1])).toEqual(['target', 'middle']);
    expect(get().branchHistoryPast).toHaveLength(1);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['root', 'middle', 'leaf']);
    expect(messageTexts(get().chats![1])).toEqual(['target']);
    get().redoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['root', 'leaf']);
    expect(messageTexts(get().chats![1])).toEqual(['target', 'middle']);
  });

  it('moves within one chat without dropping later nodes', () => {
    const { get, root, middle, leaf, other } = rangeState();
    expect(get().moveBranchSequence({ sourceChatId: 'a', fromNodeId: middle, toNodeId: middle, targetChatId: 'a', afterNodeId: leaf }).status).toBe('moved');
    const tree = get().chats![0].branchTree!;
    expect(tree.nodes[leaf].parentId).toBe(root);
    expect(tree.nodes[other].parentId).toBe(root);
    expect(messageTexts(get().chats![0])).toEqual(['root', 'leaf', 'middle']);
  });

  it('restores only the affected system prompt for body and role undo and redo', () => {
    const get = makeState();
    get().setChats([chat('a', 'old prompt')]);
    get().ensureBranchTree(0);
    const root = get().chats![0].branchTree!.rootId;
    get().updateNodeRole({ chatId: 'a', nodeId: root, role: 'system' });
    get().invalidateBranchHistory(['a']);
    get().saveNode({ chatId: 'a', nodeId: root, role: 'system', content: content('new prompt') });
    const updated = get().chats!.slice();
    updated[0] = { ...updated[0], config: { ...updated[0].config, temperature: 0.25 } };
    get().setChats(updated);
    get().undoBranch();
    expect(get().chats![0].config.systemPrompt).toBe('old prompt');
    expect(get().chats![0].config.temperature).toBe(0.25);
    get().redoBranch();
    expect(get().chats![0].config.systemPrompt).toBe('new prompt');
    get().saveNode({ chatId: 'a', nodeId: root, role: 'user', content: content('new prompt') });
    expect(get().chats![0].config.systemPrompt).toBeUndefined();
    get().undoBranch();
    expect(get().chats![0].config.systemPrompt).toBe('new prompt');
    expect(get().chats![0].messages[0].role).toBe('system');
    get().redoBranch();
    expect(get().chats![0].config.systemPrompt).toBeUndefined();
    get().updateNodeRole({ chatId: 'a', nodeId: root, role: 'system' });
    expect(get().chats![0].config.systemPrompt).toBe('new prompt');
    get().undoBranch();
    expect(get().chats![0].config.systemPrompt).toBeUndefined();
    get().redoBranch();
    expect(get().chats![0].config.systemPrompt).toBe('new prompt');
  });
});


describe('ID editing entry points', () => {
  it('resolves IDs after reordering and rejects deleted and nonactive nodes', () => {
    const get = makeState();
    get().setChats([chat('a', 'one'), chat('b', 'other')]);
    get().ensureBranchTree(0);
    const nodeId = get().chats![0].branchTree!.rootId;
    get().setChats([get().chats![1], get().chats![0]]);
    expect(get().saveNode({ chatId: 'a', nodeId, role: 'user', content: content('edited') }).status).toBe('updated');
    expect(messageTexts(get().chats![0])).toEqual(['other']);
    expect(messageTexts(get().chats![1])).toEqual(['edited']);
    const branch = get().createBranch({ chatId: 'a', fromNodeId: nodeId, content: content('branch') });
    expect(branch.status).toBe('created');
    const before = get();
    expect(get().removeNode({ chatId: 'a', nodeId }).status).toBe('invalid-target');
    expect(get().saveNode({ chatId: 'missing', nodeId, role: 'user', content: content('no') }).status).toBe('chat-missing');
    expect(get().insertNode({ chatId: 'a', beforeNodeId: 'missing', role: 'user', content: content('no') }).status).toBe('node-missing');
    expect(get()).toBe(before);
  });

  it('keeps save protection separate from role, branch and move policies', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    const appended = get().appendNode({ chatId: 'a', role: 'assistant', content: content('two') });
    if (appended.status !== 'updated') throw new Error('append failed');
    const nodeId = appended.nodeId;
    get().setNodeProtected({ chatId: 'a', nodeId, value: true });
    const before = get();
    expect(get().saveNode({ chatId: 'a', nodeId, role: 'assistant', content: content('no') }).status).toBe('protected');
    expect(get().removeNode({ chatId: 'a', nodeId }).status).toBe('protected');
    expect(get()).toBe(before);
    expect(get().updateNodeRole({ chatId: 'a', nodeId, role: 'user' }).status).toBe('updated');
    expect(get().moveNode({ chatId: 'a', nodeId, direction: 'up' }).status).toBe('updated');
    expect(get().createBranch({ chatId: 'a', fromNodeId: nodeId }).status).toBe('created');
  });

  it('reports protected prune as partial success and skips unchanged history', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    get().ensureBranchTree(0);
    const nodeId = get().chats![0].branchTree!.rootId;
    const appended = get().appendNode({ chatId: 'a', role: 'assistant', content: content('two') });
    if (appended.status !== 'updated') throw new Error('append failed');
    get().setNodeProtected({ chatId: 'a', nodeId: appended.nodeId, value: true });
    get().invalidateBranchHistory(['a']);
    expect(get().saveNode({ chatId: 'a', nodeId, role: 'user', content: content('one') }).status).toBe('unchanged');
    expect(get().branchHistoryPast).toHaveLength(0);
    const result = get().replaceNodeAndPrune({ chatId: 'a', nodeId, role: 'user', content: content('edited'), removeCount: 1 });
    expect(result).toEqual({ status: 'updated', removedNodeIds: [], pruneBlockedBy: [appended.nodeId] });
    expect(messageTexts(get().chats![0])).toEqual(['edited', 'two']);
    expect(get().branchHistoryPast).toHaveLength(1);
    const before = get();
    expect(get().replaceNodeAndPrune({ chatId: 'a', nodeId, role: 'user', content: content('no'), removeCount: -1 }).status).toBe('invalid-input');
    expect(get()).toBe(before);
  });

  it('preserves flat-node attributes through tree creation and keeps their history policy', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    expect(get().setNodeOmitted({ chatId: 'a', nodeId: '0', value: true }).status).toBe('updated');
    expect(get().setNodeCollapsed({ chatId: 'a', nodeId: '0', value: true }).status).toBe('updated');
    expect(get().branchHistoryPast).toHaveLength(0);
    expect(get().saveNode({ chatId: 'a', nodeId: '0', role: 'user', content: content('edited') }).status).toBe('updated');
    const id = get().chats![0].branchTree!.rootId;
    expect(get().chats![0].omittedNodes).toEqual({ [id]: true });
    expect(get().omittedNodeMaps['0']).toEqual({ [id]: true });
    get().setNodeStar({ chatId: 'a', nodeId: id, value: true });
    const before = get();
    expect(get().setNodeStar({ chatId: 'a', nodeId: id, value: true }).status).toBe('unchanged');
    expect(get()).toBe(before);
    get().undoBranch();
    expect(get().chats![0].branchTree!.nodes[id].starred).toBeUndefined();
    expect(get().chats![0].omittedNodes?.[id]).toBe(true);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one']);
    expect(get().chats![0].branchTree!.rootId).toBe(id);
    expect(get().omittedNodeMaps['0']).toEqual({ [id]: true });
  });
  it('blocks busy saves but keeps generation nodes when deleted from the active path', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    get().ensureBranchTree(0);
    const nodeId = get().chats![0].branchTree!.rootId;
    get().addSession({ sessionId: 'session', chatId: 'a', chatIndex: 0, targetNodeId: nodeId, messageIndex: 0, mode: 'append', insertIndex: null, requestPath: 'fetch', startedAt: 1 });
    const before = get();
    expect(get().saveNode({ chatId: 'a', nodeId, role: 'user', content: content('busy') }).status).toBe('busy');
    expect(get()).toBe(before);
    expect(get().removeNode({ chatId: 'a', nodeId }).status).toBe('updated');
    expect(get().chats![0].branchTree!.nodes[nodeId]).toBeDefined();
    expect(get().chats![0].branchTree!.activePath).not.toContain(nodeId);
  });

  it('inserts by node identity and keeps the system node immovable without history', () => {
    const get = makeState();
    get().setChats([chat('a', 'one')]);
    get().ensureBranchTree(0);
    const nodeId = get().chats![0].branchTree!.rootId;
    get().updateNodeRole({ chatId: 'a', nodeId, role: 'system' });
    const result = get().insertNode({ chatId: 'a', beforeNodeId: null, role: 'assistant', content: content('two') });
    if (result.status !== 'updated') throw new Error('insert failed');
    const before = get();
    expect(get().moveNode({ chatId: 'a', nodeId: result.nodeId, direction: 'up' }).status).toBe('unchanged');
    expect(get()).toBe(before);
    get().insertNode({ chatId: 'a', beforeNodeId: result.nodeId, role: 'user', content: content('between') });
    expect(messageTexts(get().chats![0])).toEqual(['one', 'between', 'two']);
    get().undoBranch();
    expect(messageTexts(get().chats![0])).toEqual(['one', 'two']);
  });

});


describe('message attributes with node identity commands', () => {
  it('preserves opaque attributes through cut and paste without storing command fields', () => {
    const get = makeState();
    const source = chat('a', 'source');
    Object.assign(source.messages[0], { vendor: { trace: 'opaque' } });
    get().setChats([source, chat('b', 'target')]);
    get().ensureBranchTree(0);
    get().ensureBranchTree(1);
    const nodeId = get().chats![0].branchTree!.rootId;
    const afterNodeId = get().chats![1].branchTree!.rootId;
    expect(get().saveNode({ chatId: 'a', nodeId, role: 'user', content: content('edited') }).status).toBe('updated');
    expect(get().chats![0].branchTree!.messageAttributesV1?.byNode[nodeId]).toEqual({ vendor: { trace: 'opaque' } });
    expect(get().cutBranchSequence({ chatId: 'a', fromNodeId: nodeId, toNodeId: nodeId }).status).toBe('cut');
    expect(get().chats![0].branchTree!.messageAttributesV1?.byNode).toEqual({});
    const pasted = get().pasteBranchSequence({ chatId: 'b', afterNodeId });
    if (pasted.status !== 'pasted') throw new Error('paste failed');
    expect(get().chats![1].branchTree!.messageAttributesV1?.byNode[pasted.nodeIds[0]]).toEqual({ vendor: { trace: 'opaque' } });
  });
});
