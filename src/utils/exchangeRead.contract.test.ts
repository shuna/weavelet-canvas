import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchNode, ChatInterface, ContentInterface, FolderCollection } from '@type/chat';
import type { ExportV3 } from '@type/export';
import { validateExportV3 } from './import';
import { resolveContent, type ContentStoreData } from './contentStore';
import { prepareChatForExport } from './chatExport';

const context = vi.hoisted(() => {
  const state = {
    chats: [] as ChatInterface[],
    folders: {} as FolderCollection,
    contentStore: {} as ContentStoreData,
    currentChatIndex: -1,
  };
  return { state };
});

vi.mock('@store/store', () => ({
  default: {
    getState: () => ({
      ...context.state,
      setChats: (chats: ChatInterface[]) => { context.state.chats = chats; },
      setFolders: (folders: FolderCollection) => { context.state.folders = folders; },
      setCurrentChatIndex: (index: number) => { context.state.currentChatIndex = index; },
    }),
    setState: (patch: Partial<typeof context.state>) => {
      if (patch.chats !== undefined) context.state.chats = patch.chats;
      if (patch.folders !== undefined) context.state.folders = patch.folders;
      if (patch.contentStore !== undefined) context.state.contentStore = patch.contentStore;
      if (patch.currentChatIndex !== undefined) context.state.currentChatIndex = patch.currentChatIndex;
    },
  },
  createPartializedState: (state: typeof context.state) => ({
    chats: state.chats,
    folders: state.folders,
    contentStore: state.contentStore,
  }),
}));

const { importChatFromFile } = await import('@components/ImportExportChat/importService');

type ReadCase = {
  name: string;
  spec: 'accept' | 'reject' | 'outside-expanded-v3';
  payload: ExportV3;
  observed: {
    validator: boolean | 'throws';
    importSuccess: boolean;
    resolvedBody?: ContentInterface[];
    inactiveNode?: BranchNode;
    resolvedInactive?: ContentInterface[];
    exportedInactiveEntry?: ContentStoreData[string] | null;
    resolveThrows?: boolean;
  };
};

const fixture = JSON.parse(readFileSync(
  new URL('../../tests/fixtures/web-native/exchange-read.json', import.meta.url),
  'utf8'
)) as { version: number; cases: ReadCase[] };

describe('expanded V3 exchange read contract and Web observations', () => {
  beforeEach(() => {
    context.state.chats = [];
    context.state.folders = {};
    context.state.contentStore = { existing: { content: [{ type: 'text', text: 'keep' }], refCount: 1 } };
    context.state.currentChatIndex = -1;
    vi.stubGlobal('FileReader', class {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      readAsText(file: File) {
        file.text().then((result) => this.onload?.({ target: { result } }));
      }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(fixture.cases)('$name', async ({ payload, observed, spec }) => {
    expect(fixture.version).toBe(1);
    const candidate = structuredClone(payload);
    if (observed.validator === 'throws') {
      expect(() => validateExportV3(candidate)).toThrow();
    } else {
      expect(validateExportV3(candidate)).toBe(observed.validator);
    }

    const before = structuredClone(context.state);
    const text = JSON.stringify(payload);
    const file = { name: 'exchange.json', text: async () => text } as File;
    const result = await importChatFromFile(file, (key) => key);
    expect(result.success).toBe(observed.importSuccess);
    expect(context.state.contentStore.existing).toEqual(before.contentStore.existing);
    if (!result.success) {
      expect(context.state).toEqual(before);
      return;
    }

    expect(context.state.chats).toHaveLength(1);
    expect(context.state.chats[0].id).not.toBe(payload.chats![0].id);
    if (observed.inactiveNode) {
      expect(context.state.chats[0].branchTree!.nodes.inactive).toEqual(observed.inactiveNode);
      const hash = observed.inactiveNode.contentHash;
      expect(resolveContent(context.state.contentStore, hash)).toEqual(observed.resolvedInactive);
    }
    const readBody = () => resolveContent(context.state.contentStore, 'body');
    if (observed.resolveThrows) {
      expect(readBody).toThrow();
    } else {
      expect(readBody()).toEqual(observed.resolvedBody);
      const prepared = prepareChatForExport(context.state.chats[0], context.state.contentStore);
      expect(prepared.contentStore.body?.content ?? []).toEqual(observed.resolvedBody);
      if (prepared.contentStore.body) {
        expect(prepared.contentStore.body).not.toHaveProperty('delta');
      }
      if (observed.inactiveNode) {
        expect(prepared.chat.branchTree!.nodes.inactive).toEqual(observed.inactiveNode);
        expect(prepared.contentStore[observed.inactiveNode.contentHash] ?? null)
          .toEqual(observed.exportedInactiveEntry);
      }
    }

    if (spec === 'accept') {
      const imported = context.state.chats[0];
      const source = payload.chats![0];
      expect({ ...imported, id: source.id }).toEqual(source);
      expect(context.state.folders).toEqual(payload.folders);
      expect(context.state.contentStore.body).toEqual(payload.contentStore.body);
    }
  });
});
