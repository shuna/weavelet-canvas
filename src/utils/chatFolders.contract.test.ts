import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand';
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
import { applyFolderOperation, orderedFolders } from './chatFolders';
import { folderOperation, folderRows } from '../../shared/google-sync/folders';
import { createChatSlice } from '../store/chat-slice';
import type { StoreState } from '../store/store';

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/folder-operations.json', import.meta.url), 'utf8'));
const fields = ['id', 'name', 'order', 'expanded', 'color'];
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
    const set = ((partial: any) => {
      state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
      writes.push(state);
      if (fail) throw new Error('FAKE WRITE FAILURE');
    }) as StoreApi<StoreState>['setState'];
    const get = () => state;
    state = { ...createChatSlice(set, get), ...structuredClone(fixture.input) } as StoreState;
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
