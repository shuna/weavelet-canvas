import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import DiffMatchPatch from 'diff-match-patch';
import type { ChatInterface, ConfigInterface } from '@type/chat';
import type { ContentStoreData } from './contentStore';
import { addLibraryChat, deleteLibraryChats, duplicateLibraryChat, renameLibraryChat } from './chatLibrary';
import { createChatSlice } from '@store/chat-slice';

vi.mock('uuid', () => ({ v4: () => 'new-copy' }));

type Document = { chats: ChatInterface[]; contentStore: ContentStoreData; [key: string]: unknown };
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/library-operations.json', import.meta.url), 'utf8')) as {
  fixtureVersion: number;
  defaults: { config: ConfigInterface; imageDetail: ChatInterface['imageDetail'] };
  cases: { name: string; operation: string; input: Document; expected: Document; selectedID: string }[];
};
const create = (title = 'New Chat'): ChatInterface => ({
  id: 'new-created', title, messages: [], config: structuredClone(fixture.defaults.config),
  titleSet: false, imageDetail: fixture.defaults.imageDetail,
});

describe('shared Web/native library operations', () => {
  it.each(fixture.cases)('$name preserves the complete external document', ({ operation, input, expected, selectedID }) => {
    const before = structuredClone(input);
    let result = { chats: input.chats, contentStore: input.contentStore };
    switch (operation) {
      case 'create': result.chats = addLibraryChat(input.chats, create); break;
      case 'rename': result.chats = renameLibraryChat(input.chats, 0, 'Renamed'); break;
      case 'duplicate': result = duplicateLibraryChat(input.chats, 0, input.contentStore); break;
      case 'delete': result = deleteLibraryChats(input.chats, [0], input.contentStore, create); break;
      case 'delete-flat': result = deleteLibraryChats(input.chats, [1], input.contentStore, create); break;
      case 'delete-all': result = deleteLibraryChats(input.chats, [0, 1], input.contentStore, create); break;
      default: throw Error('Unknown fixture operation');
    }
    expect({ ...input, ...result }).toEqual(expected);
    expect(result.chats[0].id).toBe(selectedID);
    expect(input).toEqual(before);
    for (const chat of result.chats) {
      const expectedChat = expected.chats.find(c => c.id === chat.id)!;
      expect(Object.keys(chat.branchTree?.nodes ?? {})).toEqual(Object.keys(expectedChat.branchTree?.nodes ?? {}));
    }
  });

  it('keeps duplicated nested metadata independent from the original', () => {
    const input = structuredClone(fixture.cases[0].input);
    const copy = duplicateLibraryChat(input.chats, 0, input.contentStore).chats[0];
    copy.config.model = 'changed';
    const node = Object.values(copy.branchTree!.nodes)[0];
    node.role = 'user';
    expect(input.chats[0]).toEqual(fixture.cases[0].input.chats[0]);
  });

  it('publishes the chat list and content references together', () => {
    const input = structuredClone(fixture.cases[0].input);
    const observed: unknown[] = [];
    let state: any;
    const set = (update: (previous: any) => any) => {
      state = { ...state, ...update(state) };
      observed.push({ chats: state.chats, contentStore: state.contentStore });
    };
    state = { ...createChatSlice(set as any, () => state), chats: input.chats,
      contentStore: input.contentStore, invalidateBranchHistory: vi.fn() };
    const next = duplicateLibraryChat(input.chats, 0, input.contentStore);
    state.setChats(next.chats, { contentStore: next.contentStore });
    expect(observed).toEqual([next]);
    expect(input).toEqual(fixture.cases[0].input);
  });

  it('rejects insufficient reference counts before changing data', () => {
    const input = structuredClone(fixture.cases[0].input);
    const hash = Object.values(input.chats[0].branchTree!.nodes)[0].contentHash;
    input.contentStore[hash].refCount = 0;
    const before = structuredClone(input);
    expect(() => deleteLibraryChats(input.chats, [0], input.contentStore, create)).toThrow('reference count');
    expect(input).toEqual(before);
  });

  it('does not treat a streaming buffer as missing persisted content during deletion', () => {
    const input = structuredClone(fixture.cases[0].input);
    const node = Object.values(input.chats[0].branchTree!.nodes)[0];
    const originalHash = node.contentHash;
    node.contentHash = '__streaming:' + node.id;
    const before = structuredClone(input);
    const next = deleteLibraryChats(input.chats, [0], input.contentStore, create);
    expect(next.chats.map(chat => chat.id)).toEqual(['chat-b']);
    expect(next.contentStore[originalHash]).toEqual(input.contentStore[originalHash]);
    expect(input).toEqual(before);
  });

  it('promotes remaining delta dependents without mutating the previous content store', () => {
    const base = [{ type: 'text' as const, text: 'base content' }];
    const content = [{ type: 'text' as const, text: 'changed content' }];
    const dmp = new DiffMatchPatch();
    const store: ContentStoreData = {
      base: { content: base, refCount: 1 },
      dependent: { content: [], refCount: 1, delta: { baseHash: 'base', patches: dmp.patch_toText(dmp.patch_make(JSON.stringify(base), JSON.stringify(content))) } },
    };
    const first = create('First'), second = create('Second');
    second.id = 'second';
    first.branchTree = { rootId: 'a', activePath: ['a'], nodes: { a: { id: 'a', parentId: null, role: 'user', contentHash: 'base', createdAt: 0 } } };
    second.branchTree = { rootId: 'b', activePath: ['b'], nodes: { b: { id: 'b', parentId: null, role: 'assistant', contentHash: 'dependent', createdAt: 0 } } };
    const before = structuredClone(store);
    const result = deleteLibraryChats([first, second], [0], store, create);
    expect(result.contentStore.dependent.content).toEqual(content);
    expect(result.contentStore.dependent.delta).toBeUndefined();
    expect(result.contentStore.base.refCount).toBe(0);
    expect(store).toEqual(before);
  });
});
