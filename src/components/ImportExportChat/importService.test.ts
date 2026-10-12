import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/i18n', () => ({ default: { t: (key: string) => key } }));

import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';
import type { ChatInterface, FolderCollection } from '@type/chat';
import { PartialImportError } from '@utils/import';
import { resolveContent, type ContentStoreData } from '@utils/contentStore';

const testContext = vi.hoisted(() => {
  const toastInfo = vi.fn();
  const toastWarning = vi.fn();
  const initialStoreState = {
    chats: [] as ChatInterface[],
    folders: {} as FolderCollection,
    contentStore: {} as Record<string, unknown>,
    apiKey: undefined as string | undefined,
    theme: 'dark',
    currentChatIndex: -1,
  };
  const storeState: {
    chats: ChatInterface[];
    folders: FolderCollection;
    contentStore: Record<string, unknown>;
    apiKey?: string;
    theme: string;
    currentChatIndex: number;
  } & Record<string, unknown> = {
    ...initialStoreState,
  };
  const setChats = vi.fn((chats: ChatInterface[]) => {
    storeState.chats = chats;
  });
  const setFolders = vi.fn((folders: FolderCollection) => {
    storeState.folders = folders;
  });
  const setCurrentChatIndex = vi.fn((currentChatIndex: number) => {
    storeState.currentChatIndex = currentChatIndex;
  });
  const setState = vi.fn((patch: Record<string, unknown>) => {
    Object.assign(storeState, patch);
  });
  const importOpenAIChatExportMock = vi.fn();
  const createPartializedState = vi.fn((state: typeof storeState) => ({
    chats: state.chats,
    folders: state.folders,
    contentStore: state.contentStore,
    apiKey: state.apiKey,
    theme: state.theme,
  }));

  return {
    toastInfo,
    toastWarning,
    initialStoreState,
    storeState,
    setChats,
    setFolders,
    setCurrentChatIndex,
    setState,
    importOpenAIChatExportMock,
    createPartializedState,
  };
});

vi.mock('@utils/showToast', () => ({
  showToast: (...args: unknown[]) => {
    const [, status] = args;
    if (status === 'info') testContext.toastInfo(...args);
    if (status === 'warning') testContext.toastWarning(...args);
  },
}));

vi.mock('@store/store', () => ({
  default: {
    getState: () => ({
      chats: testContext.storeState.chats,
      folders: testContext.storeState.folders,
      contentStore: testContext.storeState.contentStore,
      branchClipboard: testContext.storeState.branchClipboard,
      apiKey: testContext.storeState.apiKey,
      theme: testContext.storeState.theme,
      currentChatIndex: testContext.storeState.currentChatIndex,
      providerCustomModels: {},
      setChats: testContext.setChats,
      setFolders: testContext.setFolders,
      setCurrentChatIndex: testContext.setCurrentChatIndex,
    }),
    getInitialState: () => ({
      ...testContext.initialStoreState,
    }),
    setState: testContext.setState,
  },
  createPartializedState: testContext.createPartializedState,
}));

vi.mock('@utils/import', async () => {
  const actual = await vi.importActual<typeof import('@utils/import')>('@utils/import');
  return {
    ...actual,
    importOpenAIChatExport: testContext.importOpenAIChatExportMock,
  };
});

class MockFileReader {
  public onload: ((event: { target: { result: string } }) => void) | null = null;

  readAsText(file: File) {
    file.text().then((text) => {
      this.onload?.({ target: { result: text } });
    });
  }
}

Object.defineProperty(globalThis, 'FileReader', {
  value: MockFileReader,
  configurable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: {
    confirm: vi.fn(),
  },
  configurable: true,
});

const { importChatFromFile } = await import('./importService');

const t = (key: string) => key;

const createChat = (id: string, title = 'Chat'): ChatInterface => ({
  id,
  title,
  titleSet: true,
  config: { ..._defaultChatConfig },
  imageDetail: _defaultImageDetail,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
});

const createBranchChat = (id: string, hashes: string[]): ChatInterface => ({
  ...createChat(id),
  branchTree: {
    rootId: 'node-0', activePath: ['node-0'],
    nodes: Object.fromEntries(hashes.map((contentHash, index) => [`node-${index}`, {
      id: `node-${index}`, parentId: index ? `node-${index - 1}` : null,
      role: index ? 'assistant' : 'user', contentHash, createdAt: index,
    }])),
  },
});

describe('importService', () => {
  beforeEach(() => {
    testContext.storeState.chats = [createChat('existing-chat', 'Existing')];
    testContext.storeState.folders = {};
    testContext.storeState.contentStore = {};
    testContext.storeState.branchClipboard = null;
    testContext.storeState.apiKey = 'existing-key';
    testContext.storeState.theme = 'light';
    testContext.storeState.currentChatIndex = 0;
    testContext.setChats.mockClear();
    testContext.setFolders.mockClear();
    testContext.setCurrentChatIndex.mockClear();
    testContext.setState.mockClear();
    testContext.toastInfo.mockClear();
    testContext.toastWarning.mockClear();
    testContext.importOpenAIChatExportMock.mockReset();
    testContext.createPartializedState.mockClear();
    vi.mocked(window.confirm).mockReset();
  });

  it('restores snapshot when import format is unrecognized', async () => {
    const file = new File([JSON.stringify({ foo: 'bar' })], 'import.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: false,
      message: 'notifications.unrecognisedDataFormat',
    });
    expect(testContext.storeState.chats).toEqual([createChat('existing-chat', 'Existing')]);
  });

  it('retries partial OpenAI import after confirmation', async () => {
    const importedChat = createChat('imported-chat', 'Imported');
    const openAIExport = [
      {
        title: 'Imported',
        current_node: 'node-1',
        mapping: {
          'node-1': {
            id: 'node-1',
            parent: null,
            children: [],
            message: {
              author: { role: 'user' },
              content: { parts: ['hello'] },
            },
          },
        },
      },
    ];

    testContext.importOpenAIChatExportMock
      .mockImplementationOnce(() => {
        throw new PartialImportError('partial', importedChat);
      })
      .mockReturnValueOnce([importedChat]);
    vi.mocked(window.confirm).mockReturnValue(true);

    const file = new File([JSON.stringify(openAIExport)], 'openai.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: true,
      message: 'notifications.successfulImport',
    });
    expect(testContext.importOpenAIChatExportMock).toHaveBeenCalledTimes(2);
    expect(testContext.storeState.chats[0].id).not.toBe('imported-chat');
    expect(testContext.storeState.chats[0].title).toBe('Imported');
    expect(testContext.storeState.chats[1].id).toBe('existing-chat');
  });

  it('fails and restores snapshot when quota retry is declined', async () => {
    const openAIExport = [
      {
        title: 'Imported',
        current_node: 'node-1',
        mapping: {
          'node-1': {
            id: 'node-1',
            parent: null,
            children: [],
            message: {
              author: { role: 'user' },
              content: { parts: ['hello'] },
            },
          },
        },
      },
    ];

    testContext.importOpenAIChatExportMock.mockImplementation(() => {
      const error = new Error('quota');
      (error as Error & { name: string }).name = 'QuotaExceededError';
      throw error;
    });
    vi.mocked(window.confirm).mockReturnValue(false);

    const file = new File([JSON.stringify(openAIExport)], 'quota.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: false,
      message: 'notifications.quotaExceeded',
    });
    expect(testContext.storeState.chats).toEqual([createChat('existing-chat', 'Existing')]);
  });

  it('deduplicates chat ids when importing export v3 data', async () => {
    const file = new File([
      JSON.stringify({
        version: 3,
        folders: {},
        contentStore: {},
        chats: [createChat('dup-chat', 'Imported A'), createChat('dup-chat', 'Imported B')],
      }),
    ], 'export-v3.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: true,
      message: 'notifications.successfulImport',
    });
    expect(testContext.storeState.chats[0].id).not.toBe('dup-chat');
    expect(testContext.storeState.chats[1].id).not.toBe('dup-chat');
    expect(testContext.storeState.chats[0].id).not.toBe(testContext.storeState.chats[1].id);
  });

  it('clears orphaned folder references when importing a single-chat export v3 file', async () => {
    const orphanedFolderChat: ChatInterface = {
      ...createChat('orphaned-folder-chat', 'Imported Folderless'),
      folder: 'missing-folder-id',
    };
    const file = new File([
      JSON.stringify({
        version: 3,
        folders: {},
        contentStore: {},
        chats: [orphanedFolderChat],
      }),
    ], 'orphaned-folder-v3.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: true,
      message: 'notifications.successfulImport',
    });
    expect(testContext.storeState.chats[0].folder).toBeUndefined();
  });

  it('reserves both existing and incoming suffix hashes when appending conflicting full content', async () => {
    const existing = {
      body: { content: [{ type: 'text' as const, text: 'existing' }], refCount: 4, future: { source: 'existing' } },
      body__: { content: [{ type: 'text' as const, text: 'reserved existing' }], refCount: 1 },
    };
    const before = structuredClone(existing);
    testContext.storeState.contentStore = existing;
    testContext.storeState.chats = [createBranchChat('existing-chat', ['body'])];
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', ['body', 'body_'])],
      contentStore: {
        body: { content: [{ type: 'text', text: 'incoming' }], refCount: 2, future: { source: 'incoming' } },
        body_: { content: [{ type: 'text', text: 'reserved incoming' }], refCount: 1, future: { source: 'suffix' } },
      },
    };
    const input = JSON.stringify(payload);
    const file = new File([input], 'collision-v3.json');
    expect((await importChatFromFile(file, t)).success).toBe(true);
    const store = testContext.storeState.contentStore as ContentStoreData;
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe('body___');
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-1'].contentHash).toBe('body_');
    expect(testContext.storeState.chats[1].branchTree!.nodes['node-0'].contentHash).toBe('body');
    expect(store.body).toEqual(before.body);
    expect(store.body__).toEqual(before.body__);
    expect(store.body___).toEqual(payload.contentStore.body);
    expect(store.body_).toEqual(payload.contentStore.body_);
    expect(existing).toEqual(before);
    expect(JSON.stringify(payload)).toBe(input);
    expect(await file.text()).toBe(input);
  });

  it.each(['full', 'delta'])('reuses identical %s entries without mutating existing entry references', async kind => {
    const body = kind === 'delta'
      ? { content: [], refCount: 4, delta: { baseHash: 'base', patches: '' }, future: { delta: 'opaque metadata' } }
      : { content: [{ type: 'text', text: 'shared' }], refCount: 4, future: { delta: 'opaque metadata' } };
    const existing = { base: { content: [{ type: 'text', text: 'shared' }], refCount: 2 }, body };
    const before = structuredClone(existing);
    testContext.storeState.contentStore = existing;
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', ['body'])],
      contentStore: { base: { ...existing.base, refCount: 3 }, body: { ...body, refCount: 2 } },
    };
    const input = JSON.stringify(payload);
    expect((await importChatFromFile(new File([input], 'reuse-v3.json'), t)).success).toBe(true);
    const store = testContext.storeState.contentStore as ContentStoreData;
    expect(Object.keys(store)).toEqual(['base', 'body']);
    expect(store.body).toEqual({ ...before.body, refCount: 6 });
    expect(store.base).toEqual({ ...before.base, refCount: 5 });
    expect(store.body).not.toBe(body);
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe('body');
    expect(resolveContent(store, 'body')).toEqual([{ type: 'text', text: 'shared' }]);
    expect(existing).toEqual(before);
    expect(JSON.stringify(payload)).toBe(input);
  });

  it('keeps equal content with different unknown metadata in separate entries', async () => {
    const existing = { content: [{ type: 'text', text: 'shared' }], refCount: 4, future: { source: 'existing' } };
    testContext.storeState.contentStore = { body: existing };
    const imported = { content: [{ type: 'text', text: 'shared' }], refCount: 2, future: { source: 'incoming' } };
    const payload = { version: 3, folders: {}, chats: [createBranchChat('incoming', ['body'])], contentStore: { body: imported } };
    expect((await importChatFromFile(new File([JSON.stringify(payload)], 'metadata-v3.json'), t)).success).toBe(true);
    expect(testContext.storeState.contentStore).toEqual({ body: existing, body_: imported });
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe('body_');
    expect(existing.refCount).toBe(4);
  });

  it('remaps a colliding base and all otherwise identical dependent deltas without changing existing chains', async () => {
    const delta = { content: [], refCount: 4, delta: { baseHash: 'base', patches: '', future: 'delta metadata' }, future: { source: 'delta' } };
    const chain = { content: [], refCount: 5, delta: { baseHash: 'delta', patches: '' }, future: { source: 'chain' } };
    const existing = {
      base: { content: [{ type: 'text', text: 'existing base' }], refCount: 7, future: { source: 'existing' } },
      delta, chain,
    };
    const before = structuredClone(existing);
    testContext.storeState.contentStore = existing;
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', ['chain', 'delta', 'base', 'base_'])],
      contentStore: {
        chain: { ...chain, refCount: 1 }, delta: { ...delta, refCount: 1 },
        base: { content: [{ type: 'text', text: 'incoming base' }], refCount: 3, future: { source: 'incoming' } },
        base_: { content: [{ type: 'text', text: 'reserved incoming' }], refCount: 1 },
      },
    };
    const input = JSON.stringify(payload);
    expect((await importChatFromFile(new File([input], 'delta-collision-v3.json'), t)).success).toBe(true);
    const store = testContext.storeState.contentStore as ContentStoreData;
    expect(Object.values(testContext.storeState.chats[0].branchTree!.nodes).map(node => node.contentHash))
      .toEqual(['chain_', 'delta_', 'base__', 'base_']);
    expect(store.base).toEqual(before.base);
    expect(store.delta).toEqual(before.delta);
    expect(store.chain).toEqual(before.chain);
    expect(store.base__).toEqual(payload.contentStore.base);
    expect(store.delta_).toEqual({ ...payload.contentStore.delta, delta: { ...delta.delta, baseHash: 'base__' } });
    expect(store.chain_).toEqual({ ...payload.contentStore.chain, delta: { ...chain.delta, baseHash: 'delta_' } });
    expect(resolveContent(store, 'chain')).toEqual([{ type: 'text', text: 'existing base' }]);
    expect(resolveContent(store, 'chain_')).toEqual([{ type: 'text', text: 'incoming base' }]);
    expect(existing).toEqual(before);
    expect(JSON.stringify(payload)).toBe(input);
  });

  it.each([false, true])('keeps original hash/delta metadata on replace with includeSettings=%s', async includeSettings => {
    const existing = { body: { content: [{ type: 'text', text: 'existing' }], refCount: 4 } };
    const before = structuredClone(existing);
    testContext.storeState.contentStore = existing;
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', ['body'])],
      contentStore: {
        base: { content: [{ type: 'text', text: 'incoming' }], refCount: 1, future: { source: 'base' } },
        body: { content: [], refCount: 1, delta: { baseHash: 'base', patches: '' }, future: { delta: 'opaque metadata' } },
      },
    };
    const input = JSON.stringify(payload);
    expect((await importChatFromFile(new File([input], 'replace-delta-v3.json'), t, 'replace', includeSettings)).success).toBe(true);
    expect(testContext.storeState.contentStore).toEqual(payload.contentStore);
    expect(testContext.storeState.chats).toHaveLength(1);
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe('body');
    expect(resolveContent(testContext.storeState.contentStore as ContentStoreData, 'body'))
      .toEqual([{ type: 'text', text: 'incoming' }]);
    expect(existing).toEqual(before);
    expect(JSON.stringify(payload)).toBe(input);
  });

  it.each(['missing', 'cyclic'])('keeps the existing %s delta read boundary after collision remapping', async kind => {
    const existing = { body: { content: [{ type: 'text', text: 'existing' }], refCount: 4 } };
    const before = structuredClone(existing);
    testContext.storeState.contentStore = existing;
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', ['body'])],
      contentStore: {
        body: { content: [], refCount: 1, delta: { baseHash: kind === 'missing' ? 'absent' : 'loop', patches: '' } },
        ...(kind === 'cyclic' ? { loop: { content: [], refCount: 1, delta: { baseHash: 'body', patches: '' } } } : {}),
      },
    };
    expect((await importChatFromFile(new File([JSON.stringify(payload)], 'broken-delta-v3.json'), t)).success).toBe(true);
    const store = testContext.storeState.contentStore as ContentStoreData;
    expect(store.body).toEqual(before.body);
    expect(store.body_.delta?.baseHash).toBe(kind === 'missing' ? 'absent' : 'loop');
    if (kind === 'cyclic') expect(store.loop.delta?.baseHash).toBe('body_');
    expect(resolveContent(store, 'body_')).toEqual([]);
    expect(resolveContent(store, 'body')).toEqual([{ type: 'text', text: 'existing' }]);
    expect(existing).toEqual(before);
  });

  it.each(['constructor', '__proto__'])('handles %s as an own content key without changing the store prototype', async hash => {
    const existing = { keep: { content: [{ type: 'text', text: 'keep' }], refCount: 1 } };
    testContext.storeState.contentStore = existing;
    const original = { content: [{ type: 'text', text: 'first import' }], refCount: 2, future: { source: 'first' } };
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', [hash])],
      contentStore: Object.fromEntries([[hash, original]]),
    };
    expect((await importChatFromFile(new File([JSON.stringify(payload)], 'own-key-v3.json'), t)).success).toBe(true);
    expect(Object.hasOwn(testContext.storeState.contentStore, hash)).toBe(true);
    expect(testContext.storeState.contentStore[hash]).toEqual(original);
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe(hash);
    const incoming = { content: [{ type: 'text', text: 'second import' }], refCount: 3, future: { source: 'second' } };
    payload.contentStore = Object.fromEntries([[hash, incoming]]);
    expect((await importChatFromFile(new File([JSON.stringify(payload)], 'own-key-collision-v3.json'), t)).success).toBe(true);
    expect(Object.hasOwn(testContext.storeState.contentStore, `${hash}_`)).toBe(true);
    expect(testContext.storeState.contentStore[hash]).toEqual(original);
    expect(testContext.storeState.contentStore[`${hash}_`]).toEqual(incoming);
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe(`${hash}_`);
    expect(testContext.storeState.contentStore.keep).toEqual(existing.keep);
    expect(Object.getPrototypeOf(testContext.storeState.contentStore)).toBe(Object.prototype);
  });

  it.each(['existing', 'incoming'])('does not bind a missing %s delta base to a new collision alias', async side => {
    const missingDelta = { content: [], refCount: 1, delta: { baseHash: 'body_', patches: '' }, future: { source: side } };
    const existing = {
      body: { content: [{ type: 'text', text: 'existing' }], refCount: 4 },
      ...(side === 'existing' ? { missingDelta } : {}),
    };
    const before = structuredClone(existing);
    testContext.storeState.contentStore = existing;
    testContext.storeState.chats = [createBranchChat('existing', ['body', ...(side === 'existing' ? ['missingDelta'] : [])])];
    const payload = {
      version: 3, folders: {},
      chats: [createBranchChat('incoming', ['body', ...(side === 'incoming' ? ['missingDelta'] : [])])],
      contentStore: {
        body: { content: [{ type: 'text', text: 'incoming' }], refCount: 1 },
        ...(side === 'incoming' ? { missingDelta } : {}),
      },
    };
    const input = JSON.stringify(payload);
    expect((await importChatFromFile(new File([input], 'missing-suffix-v3.json'), t)).success).toBe(true);
    const store = testContext.storeState.contentStore as ContentStoreData;
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe('body__');
    expect(store.body).toEqual(before.body);
    expect(store.body__).toEqual(payload.contentStore.body);
    expect(Object.hasOwn(store, 'body_')).toBe(false);
    expect(store.missingDelta).toEqual(missingDelta);
    expect(resolveContent(store, 'missingDelta')).toEqual([]);
    const chat = testContext.storeState.chats[side === 'incoming' ? 0 : 1];
    expect(chat.branchTree!.nodes['node-1'].contentHash).toBe('missingDelta');
    expect(existing).toEqual(before);
    expect(JSON.stringify(payload)).toBe(input);
  });

  it('reserves missing existing, incoming and clipboard node references before choosing an alias', async () => {
    const existing = { body: { content: [{ type: 'text', text: 'existing' }], refCount: 4 } };
    testContext.storeState.contentStore = existing;
    testContext.storeState.chats = [createBranchChat('existing', ['body', 'body_'])];
    const clipboard = { nodeIds: ['clipboard'], sourceChat: 'existing', nodes: {
      clipboard: { id: 'clipboard', parentId: null, role: 'user', contentHash: 'body___', createdAt: 0 },
    } };
    testContext.storeState.branchClipboard = clipboard;
    const payload = {
      version: 3, folders: {}, chats: [createBranchChat('incoming', ['body', 'body__'])],
      contentStore: { body: { content: [{ type: 'text', text: 'incoming' }], refCount: 1 } },
    };
    expect((await importChatFromFile(new File([JSON.stringify(payload)], 'missing-node-suffix-v3.json'), t)).success).toBe(true);
    const store = testContext.storeState.contentStore as ContentStoreData;
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-0'].contentHash).toBe('body____');
    expect(testContext.storeState.chats[0].branchTree!.nodes['node-1'].contentHash).toBe('body__');
    expect(testContext.storeState.chats[1].branchTree!.nodes['node-1'].contentHash).toBe('body_');
    expect(testContext.storeState.branchClipboard).toEqual(clipboard);
    expect(store.body).toEqual(existing.body);
    expect(store.body____).toEqual(payload.contentStore.body);
    for (const hash of ['body_', 'body__', 'body___']) {
      expect(Object.hasOwn(store, hash)).toBe(false);
      expect(resolveContent(store, hash)).toEqual([]);
    }
  });

  it('replaces local conversations and settings when mode is replace', async () => {
    const file = new File([
      JSON.stringify({
        version: 3,
        folders: {},
        contentStore: {
          abc: {
            content: [{ type: 'text', text: 'hello' }],
            refCount: 1,
          },
        },
        chats: [createChat('imported-chat', 'Imported')],
      }),
    ], 'replace-v3.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t, 'replace');

    expect(result).toEqual({
      success: true,
      message: 'notifications.successfulImport',
    });
    expect(testContext.storeState.chats).toHaveLength(1);
    expect(testContext.storeState.chats[0].title).toBe('Imported');
    expect(testContext.storeState.chats[0].id).not.toBe('imported-chat');
    expect(testContext.storeState.apiKey).toBeUndefined();
    expect(testContext.storeState.theme).toBe('dark');
    expect(testContext.storeState.currentChatIndex).toBe(0);
  });

  it('rejects invalid export v3 data with broken branch references', async () => {
    const file = new File([
      JSON.stringify({
        version: 3,
        folders: {},
        contentStore: {},
        chats: [{
          ...createChat('broken-chat', 'Broken'),
          branchTree: {
            rootId: 'missing-node',
            activePath: ['missing-node'],
            nodes: {},
          },
        }],
      }),
    ], 'broken-v3.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: false,
      message: 'notifications.invalidFormatForVersion',
    });
    expect(testContext.storeState.chats[0].id).toBe('existing-chat');
  });

  it('quota retry for OpenAI array pops chats until success', async () => {
    const openAIExport = [
      {
        title: 'Chat1',
        current_node: 'n1',
        mapping: { n1: { id: 'n1', parent: null, children: [], message: { author: { role: 'user' }, content: { parts: ['a'] } } } },
      },
      {
        title: 'Chat2',
        current_node: 'n2',
        mapping: { n2: { id: 'n2', parent: null, children: [], message: { author: { role: 'user' }, content: { parts: ['b'] } } } },
      },
    ];

    let callCount = 0;
    testContext.importOpenAIChatExportMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return [createChat('survived')];
    });
    vi.mocked(window.confirm).mockReturnValue(true);

    const file = new File([JSON.stringify(openAIExport)], 'quota-array.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result.success).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(testContext.toastInfo).toHaveBeenCalled();
  });

  it('quota retry for ExportV1 pops chats from .chats array', async () => {
    const exportV1 = {
      version: 1,
      folders: {},
      chats: [
        createChat('v1-chat-1'),
        createChat('v1-chat-2'),
        createChat('v1-chat-3'),
      ],
    };

    let callCount = 0;
    testContext.setChats.mockImplementation((chats: ChatInterface[]) => {
      callCount++;
      if (callCount <= 2) {
        testContext.storeState.chats = chats;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      testContext.storeState.chats = chats;
    });
    vi.mocked(window.confirm).mockReturnValue(true);

    const file = new File([JSON.stringify(exportV1)], 'quota-v1.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result.success).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('imports a single chat object (not wrapped in array)', async () => {
    const singleChat = createChat('single-chat', 'My Single Chat');
    const file = new File([JSON.stringify(singleChat)], 'single.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: true,
      message: 'notifications.successfulImport',
    });
    expect(testContext.storeState.chats[0].id).not.toBe('single-chat');
    expect(testContext.storeState.chats[0].title).toBe('My Single Chat');
    expect(testContext.storeState.chats[1].id).toBe('existing-chat');
  });

  it('quota retry returns failure when all chats are exhausted', async () => {
    const openAIExport = [
      {
        title: 'Only',
        current_node: 'n1',
        mapping: { n1: { id: 'n1', parent: null, children: [], message: { author: { role: 'user' }, content: { parts: ['x'] } } } },
      },
    ];

    testContext.importOpenAIChatExportMock.mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.mocked(window.confirm).mockReturnValue(true);

    const file = new File([JSON.stringify(openAIExport)], 'quota-exhaust.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: false,
      message: 'notifications.quotaExceeded',
    });
  });
});
