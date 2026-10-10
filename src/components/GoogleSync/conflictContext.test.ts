import { expect, it } from 'vitest';
import { addContent } from '@utils/contentStore';
import type { Snapshot } from '@store/storage/google/records';
import { getBranchMessages, getConflictContext, parseConflictPath } from './conflictContext';

const fixture = (): Snapshot => {
  const contentStore = {};
  const node = (id: string, parentId: string | null, text: string) => ({ id, parentId, role: 'user' as const, createdAt: 1,
    contentHash: addContent(contentStore, [{ type: 'text', text }]) });
  return { version: 18, state: { contentStore, chats: [{ id: 'chat', title: 'chat', titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    branchTree: { rootId: 'root', activePath: ['root', 'target', 'right'], nodes: {
      root: node('root', null, 'before'), target: node('target', 'root', 'target text'),
      left: node('left', 'target', 'after left'), right: node('right', 'target', 'after right'),
      unrelated: node('unrelated', 'root', 'other branch'),
    } },
  }], folders: { folder: { id: 'folder', name: 'folder name', expanded: true, order: 0 } } } };
};
const key = JSON.stringify(['chats', 'chat', 'branchTree', 'nodes', 'target', 'contentHash']);

it('locates the bubble across its branches with before/after context without mutating the snapshot', () => {
  const snapshot = fixture(), original = JSON.stringify(snapshot);
  const context = getConflictContext(snapshot, key);
  expect(context.branches.map(branch => branch.id)).toEqual(['left', 'right']);
  expect(context.preferredBranch?.id).toBe('right');
  const messages = getBranchMessages(snapshot, key, 'left');
  expect(messages.map(message => message.content[0])).toEqual(['before', 'target text', 'after left'].map(text => ({ type: 'text', text })));
  expect(messages.filter(message => message.target).map(message => message.position)).toEqual([2]);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it('distinguishes missing bubbles, missing chats, legacy messages and non-chat fields', () => {
  const snapshot = fixture();
  delete snapshot.state.chats![0].branchTree!.nodes.target;
  snapshot.state.chats![0].branchTree!.nodes.left.parentId = 'root';
  snapshot.state.chats![0].branchTree!.nodes.right.parentId = 'root';
  expect(getBranchMessages(snapshot, key).some(message => message.target)).toBe(false);
  expect(getConflictContext(snapshot, key).chat).toBeDefined();
  expect(getConflictContext(snapshot, JSON.stringify(['chats', 'absent', 'title'])).chat).toBeUndefined();
  expect(getConflictContext(snapshot, JSON.stringify(['state', 'folders', 'folder', 'name'])).value).toBe('folder name');
  delete snapshot.state.chats![0].branchTree;
  snapshot.state.chats![0].messages = [{ role: 'assistant', content: [{ type: 'text', text: 'legacy' }] }];
  expect(getBranchMessages(snapshot, JSON.stringify(['chats', 'chat', 'messages']))).toMatchObject([{ position: 1, content: [{ text: 'legacy' }] }]);
  expect(parseConflictPath('invalid')).toEqual([]);
  expect(parseConflictPath('["chats", 1]')).toEqual([]);
});
