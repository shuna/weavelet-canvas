import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand';
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
import { applyFolderOperation, orderedFolders } from './chatFolders';
import { folderOperation, folderRows } from '../../shared/google-sync/folders';
import { createChatSlice } from '../store/chat-slice';
import type { StoreState } from '../store/store';

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/folder-operations.json', import.meta.url), 'utf8'));
const fields = ['id', 'name', 'order', 'expanded', 'color', 'parentId'];
const projection = (input: any) => ({
  folders: Object.fromEntries(Object.entries(input.folders).map(([id, folder]) => [id, Object.fromEntries(fields.filter(key => Object.hasOwn(folder as object, key)).map(key => [key, (folder as any)[key]]))])),
  chats: input.chats.map((chat: any) => Object.fromEntries(['id', 'folder'].filter(key => Object.hasOwn(chat, key)).map(key => [key, chat[key]]))),
});
const applyPatch = (source: any, patch: any) => {
  const patchObject = (original: any, change: any) => { const result = { ...original, ...change.set }; for (const field of change.remove) delete result[field]; return result; };
  const folders = { ...source.folders };
  for (const change of patch.folderChanges) folders[change.key] = patchObject(folders[change.key] ?? {}, change);
  const chats = source.chats.slice();
  for (const change of patch.chatChanges) chats[change.index] = patchObject(chats[change.index], change);
  return { ...source, folders: Object.fromEntries(patch.folderKeys.map((key: string) => [key, folders[key]])), chats };
};

describe('shared folder operations', () => {
  for (const item of fixture.cases) it(item.name, () => {
    const input = structuredClone(item.input ?? fixture.input), before = structuredClone(input);
    const result = applyFolderOperation(input, item.operation);
    expect(result).toEqual(item.expected);
    expect(orderedFolders(result.folders).map(folder => folder.id)).toEqual(item.orderedIDs);
    expect(input).toEqual(before);
    expect(result.contentStore).toBe(input.contentStore);
    const patch = JSON.parse(folderOperation(JSON.stringify({ ...projection(input), operation: item.operation })));
    expect(applyPatch(input, patch)).toEqual(item.expected);
    expect(JSON.parse(folderRows(JSON.stringify(projection(result)))).map((folder: any) => folder.id)).toEqual(item.orderedIDs);
    expect(JSON.stringify(patch)).not.toContain('xRoot');
    expect(JSON.stringify(patch)).not.toContain('FAKE TEST');
  });

  it('shares hierarchy removal and ancestor expansion with the native bridge without dropping metadata', () => {
    const input = structuredClone(fixture.input);
    input.folders['f-a'].expanded = false;
    input.folders['f-b'].parentId = 'f-a';
    input.folders['f-c'].parentId = 'f-b';
    input.chats[0].folder = 'f-b';
    input.chats[1].folder = 'f-c';
    const before = structuredClone(input);
    const removed = applyFolderOperation(input, { type: 'remove', id: 'f-b' });
    const expected = {
      ...input,
      folders: { 'f-a': input.folders['f-a'], 'f-c': { ...input.folders['f-c'], parentId: 'f-a' } },
      chats: [{ ...input.chats[0], folder: 'f-a' }, input.chats[1], input.chats[2]],
    };
    expect(removed).toEqual(expected);
    expect(applyPatch(input, JSON.parse(folderOperation(JSON.stringify({ ...projection(input), operation: { type: 'remove', id: 'f-b' } }))))).toEqual(expected);
    const moved = applyFolderOperation(removed, { type: 'move', chatIds: ['chat-c'], folderId: 'f-c' });
    const movedExpected = { ...expected, folders: {
      'f-a': { ...expected.folders['f-a'], expanded: true }, 'f-c': { ...expected.folders['f-c'], expanded: true },
    }, chats: [expected.chats[0], expected.chats[1], { ...input.chats[2], folder: 'f-c' }] };
    expect(moved).toEqual(movedExpected);
    expect(applyPatch(removed, JSON.parse(folderOperation(JSON.stringify({ ...projection(removed), operation: { type: 'move', chatIds: ['chat-c'], folderId: 'f-c' } }))))).toEqual(movedExpected);
    expect(() => applyFolderOperation(input, { type: 'edit', id: 'f-a', patch: { parentId: 'f-c' } })).toThrow('hierarchy');
    expect(input).toEqual(before);
  });

  it('labels same-name folders with their ancestor paths for import selection', () => {
    const make = (id: string, name: string, parentId?: string) => ({ id, name, parentId, order: 0, expanded: true });
    const folders = { a: make('a', 'A'), b: make('b', 'B'), x: make('x', 'Same', 'a'), y: make('y', 'Same', 'b') };
    const rows = JSON.parse(folderRows(JSON.stringify({ folders })));
    expect(rows.find((row: any) => row.id === 'x').path).toBe('A / Same');
    expect(rows.find((row: any) => row.id === 'y').path).toBe('B / Same');
  });

  it('projects nested folders in preorder and keeps broken chains at the root', () => {
    const folder = (id: string, order: number, parentId?: string, expanded = true) => ({ id, name: id, order, parentId, expanded });
    const folders = {
      child: folder('child', 1, 'root'), root: folder('root', 4, undefined, false), sibling: folder('sibling', 2, 'root'),
      other: folder('other', 3), orphan: folder('orphan', 5, 'missing'), cycleA: folder('cycleA', 6, 'cycleB'), cycleB: folder('cycleB', 7, 'cycleA'),
    };
    const rows = JSON.parse(folderRows(JSON.stringify({ folders })));
    expect(rows.map((row: any) => row.id)).toEqual(['other', 'root', 'child', 'sibling', 'orphan', 'cycleA', 'cycleB']);
    expect(rows.find((row: any) => row.id === 'child')).toMatchObject({ displayParentId: 'root', depth: 1, visible: false, path: 'root / child' });
    expect(rows.find((row: any) => row.id === 'orphan')).toMatchObject({ displayParentId: '', depth: 0, visible: true, path: 'orphan' });
    expect(rows.find((row: any) => row.id === 'cycleA')).toMatchObject({ displayParentId: '', depth: 0, visible: true, path: 'cycleA' });
  });

  it('rejects empty or mismatched folder identities before projecting rows', () => {
    for (const folders of [
      { '': { id: '', name: 'Bad', order: 0, expanded: true } },
      { key: { id: 'other', name: 'Bad', order: 0, expanded: true } },
    ]) expect(() => folderRows(JSON.stringify({ folders }))).toThrow('Invalid folder identity');
  });

  it('rejects invalid identities before changing anything', () => {
    const input = structuredClone(fixture.input), before = structuredClone(input);
    for (const operation of [{ type: 'create', id: 'f-a' }, { type: 'remove', id: 'missing' }, { type: 'move', chatIds: ['missing'], folderId: 'f-a' }, { type: 'move', chatIds: ['chat-a'], folderId: 'missing' }] as const) {
      expect(() => applyFolderOperation(input, operation as any)).toThrow();
      expect(input).toEqual(before);
    }
  });

  it('publishes folders and membership together and restores the whole live root after synchronous save failure', () => {
    let state: StoreState, fail = false;
    const writes: StoreState[] = [];
    const set = ((partial: any, replace?: boolean) => {
      const patch = typeof partial === 'function' ? partial(state) : partial;
      state = replace ? patch : { ...state, ...patch };
      writes.push(state);
      if (fail) throw new Error('FAKE WRITE FAILURE');
    }) as StoreApi<StoreState>['setState'];
    const get = () => state;
    state = { ...createChatSlice(set, get), ...structuredClone(fixture.input) } as StoreState;
    const initial = state;
    fail = true;
    expect(() => state.createFolder()).toThrow();
    expect(state).toEqual(initial);
    expect(Object.hasOwn(state, 'lastContentEditedAt')).toBe(false);
    fail = false;
    writes.length = 0;
    const next = applyFolderOperation(state, { type: 'remove', id: 'f-a' });
    state.setFolders(next.folders, { chats: next.chats });
    expect(writes).toHaveLength(1);
    expect(state.folders['f-a']).toBeUndefined();
    expect(state.chats![0].folder).toBeUndefined();
    const before = state;
    const move = applyFolderOperation(state, { type: 'move', chatIds: ['chat-a', 'chat-c'], folderId: 'f-b' });
    fail = true;
    expect(() => state.setFolders(move.folders, { chats: move.chats })).toThrow();
    expect(state).toEqual(before);
    expect(state.contentStore).toBe(before.contentStore);
  });
});
