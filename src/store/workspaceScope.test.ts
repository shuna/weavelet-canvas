import { describe, expect, it, vi } from 'vitest';

vi.unmock('@store/store');
vi.mock('@store/storage/CompressedStorage', () => ({ default: {
  getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(),
} }));
vi.mock('@hooks/aiTaskLifetime', () => ({ invalidateAiTasks: vi.fn() }));

import liveStore from './store';
import { createPreviewStore } from './workspaceScope';
import { invalidateAiTasks } from '@hooks/aiTaskLifetime';
import { generateDefaultChat } from '@constants/chat';
import { addContent, addContentDelta, resolveContent, type ContentStoreData } from '@utils/contentStore';
import { materializeActivePath } from '@utils/branchUtils';
import type { BranchTree } from '@type/chat';
import type { ImportPreviewSource } from '@components/ImportExportChat/importService';

const fixture = (): ImportPreviewSource => {
  const contentStore: ContentStoreData = {};
  const tree: BranchTree = { rootId: 'root', activePath: ['root', 'a'], nodes: Object.fromEntries([
    ['root', null, 'user', 'Question'], ['a', 'root', 'assistant', 'Visible'],
    ['b', 'root', 'assistant', 'Hidden needle'],
  ].map(([id, parentId, role, text]) => [id, { id, parentId, role, createdAt: 0,
    contentHash: addContent(contentStore, [{ type: 'text', text: text! }]),
  }])) as BranchTree['nodes'] };
  return { chats: [{ ...generateDefaultChat('File chat'), id: 'source', folder: 'folder', branchTree: tree,
    messages: materializeActivePath(tree, contentStore) }],
    folders: { folder: { id: 'folder', name: 'Source folder', order: 0, expanded: true } },
    contentStore, evaluationResults: {} };
};

describe('temporary read-only workspace', () => {
  it('materializes delta bodies for branch cards without changing the original file data', () => {
    const source = fixture();
    const body = 'Long source body. '.repeat(100);
    const base = addContent(source.contentStore, [{ type: 'text', text: body }]);
    const hash = addContentDelta(source.contentStore, [{ type: 'text', text: `${body}Changed ending.` }], base);
    expect(source.contentStore[hash].delta).toBeDefined();
    source.chats[0].branchTree!.nodes.b.contentHash = hash;
    const original = JSON.stringify(source);
    const preview = createPreviewStore(source);
    expect(preview.getState().contentStore[hash].delta).toBeUndefined();
    expect(preview.getState().contentStore[hash].content).toEqual(resolveContent(source.contentStore, hash));
    expect(JSON.stringify(source)).toBe(original);
  });

  it('searches and navigates hidden branches without changing source, live state or local storage', () => {
    const source = fixture();
    const originalSource = JSON.stringify(source);
    const before = liveStore.getState();
    const changed = vi.fn();
    const unsubscribe = liveStore.subscribe(changed);
    const localWrite = vi.spyOn(localStorage, 'setItem');
    const preview = createPreviewStore(source);
    expect(preview.getState().chats).not.toBe(source.chats);
    expect(preview.getState().contentStore).not.toBe(source.contentStore);
    expect(preview.getState().folders).not.toBe(source.folders);
    preview.getState().setGrepQuery('Hidden needle');
    preview.getState().executeGrep();
    expect(preview.getState().grepResults.flatMap(result => result.matches)).toEqual(expect.arrayContaining([
      expect.objectContaining({ chatId: 'source', nodeId: 'b' }),
    ]));
    preview.getState().navigateToNode({ chatId: 'source', nodeId: 'b', source: 'search',
      history: 'push', focus: 'none' });
    expect(preview.getState().chats![0].branchTree!.activePath).toEqual(['root', 'b']);
    expect(preview.getState().chats![0].messages.at(-1)!.content).toEqual([{ type: 'text', text: 'Hidden needle' }]);
    preview.getState().setNodeCollapsed({ chatId: 'source', nodeId: 'b', value: true });
    expect(preview.getState().chats![0].collapsedNodes?.b).toBe(true);
    expect(JSON.stringify(source)).toBe(originalSource);
    expect(liveStore.getState()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    unsubscribe();
    localWrite.mockRestore();
  });

  it('rejects content-changing actions before mutation or global AI invalidation', () => {
    const source = fixture();
    const preview = createPreviewStore(source);
    const before = preview.getState();
    const snapshot = JSON.stringify({ chats: before.chats, contentStore: before.contentStore, folders: before.folders });
    const changed = vi.fn();
    const unsubscribe = preview.subscribe(changed);
    vi.mocked(invalidateAiTasks).mockClear();
    preview.getState().removeChats({ chatIds: ['source'] });
    preview.getState().renameChat({ chatId: 'source', title: 'Changed' });
    preview.getState().setChats([]);
    preview.getState().removeNode({ chatId: 'source', nodeId: 'b' });
    preview.getState().setNodeStar({ chatId: 'source', nodeId: 'b', value: true });
    preview.getState().undoBranch();
    const after = preview.getState();
    expect(JSON.stringify({ chats: after.chats, contentStore: after.contentStore, folders: after.folders })).toBe(snapshot);
    expect(changed).not.toHaveBeenCalled();
    expect(invalidateAiTasks).not.toHaveBeenCalled();
    expect(preview.getState().canUndoBranch()).toBe(false);
    expect(preview.getState().canRedoBranch()).toBe(false);
    unsubscribe();
  });
});
