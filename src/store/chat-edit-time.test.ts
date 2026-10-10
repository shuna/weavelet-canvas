import { afterEach, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand';
import type { StoreState } from './store';
import type { ChatInterface } from '@type/chat';
import { createChatSlice } from './chat-slice';
import { createBranchSlice } from './branch-slice';
import { createPartializedState } from './persistence';
import { toRecords, fromRecords } from './storage/google/records';

afterEach(() => vi.restoreAllMocks());

it('records edits, undo and deletion, but not viewing, and preserves times through sync', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  let state: StoreState;
  const get = () => state;
  const set = ((partial: any) => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }; }) as StoreApi<StoreState>['setState'];
  state = { ...createChatSlice(set, get), ...createBranchSlice(set, get) } as StoreState;
  const chat: ChatInterface = { id: 'chat', title: 'title', titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'before' }] }] };
  state.setChats([chat]);
  expect(state.chats![0].updatedAt).toBe(1000);
  clock.mockReturnValue(2000);
  state.upsertMessageAtIndex(0, 0, 'user', [{ type: 'text', text: 'after' }]);
  const edited = state.chats![0];
  const nodeId = edited.branchTree!.rootId;
  expect(edited.updatedAt).toBe(2000);
  expect(edited.branchTree!.nodes[nodeId].updatedAt).toBe(2000);
  clock.mockReturnValue(3000);
  state.setChats(state.chats!.slice());
  state.toggleCollapseNode(0, 0);
  state.switchActivePathSilent(0, [nodeId]);
  expect(state.chats![0].updatedAt).toBe(2000);
  expect(state.lastContentEditedAt).toBe(2000);
  const restored = await fromRecords(await toRecords({ version: 18, state: createPartializedState(state) }));
  expect(restored.state.chats![0].updatedAt).toBe(2000);
  expect(restored.state.lastContentEditedAt).toBe(2000);
  clock.mockReturnValue(4000);
  state.undoBranch();
  expect(state.chats![0].updatedAt).toBe(4000);
  clock.mockReturnValue(5000);
  state.setChats([]);
  expect(state.lastContentEditedAt).toBe(5000);
  clock.mockReturnValue(6000);
  state.setFolders({ folder: { id: 'folder', name: 'folder', order: 0, expanded: true } });
  expect(state.lastContentEditedAt).toBe(6000);
  clock.mockReturnValue(7000);
  state.setFolders({ folder: { ...state.folders.folder, expanded: false } });
  expect(state.lastContentEditedAt).toBe(6000);
});
