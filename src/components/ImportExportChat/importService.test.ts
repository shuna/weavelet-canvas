import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';
import type { ChatInterface, FolderCollection } from '@type/chat';
import { PartialImportError } from '@utils/import';

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
    branchClipboard: state.branchClipboard,
    evaluationSettings: state.evaluationSettings,
    evaluationResults: state.evaluationResults,
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
    invalidateAiTasks: vi.fn(),
    saveChatData: vi.fn(),
    setLocalStorageItem: vi.fn(),
    normalizeSystemPrompt: vi.fn(),
  };
});

vi.mock('@hooks/aiTaskLifetime', () => ({
  invalidateAiTasks: testContext.invalidateAiTasks,
}));

vi.mock('@utils/showToast', () => ({
  showToast: (...args: unknown[]) => {
    const [, status] = args;
    if (status === 'info') testContext.toastInfo(...args);
    if (status === 'warning') testContext.toastWarning(...args);
  },
}));

vi.mock('@store/store', () => ({
  default: {
    getState: () => testContext.storeState,
    getInitialState: () => ({
      ...testContext.initialStoreState,
    }),
    setState: testContext.setState,
  },
  createPartializedState: testContext.createPartializedState,
}));

vi.mock('@store/persistence', () => ({
  createPersistedChatDataState: (state: Record<string, unknown>) => ({
    chats: state.chats, contentStore: state.contentStore, branchClipboard: state.branchClipboard,
  }),
}));
vi.mock('@store/storage/IndexedDbStorage', () => ({ saveChatData: testContext.saveChatData }));
vi.mock('@store/storage/storageErrors', () => ({ setLocalStorageItem: testContext.setLocalStorageItem }));
vi.mock('@utils/systemPromptNormalize', async () => {
  const actual = await vi.importActual<typeof import('@utils/systemPromptNormalize')>('@utils/systemPromptNormalize');
  testContext.normalizeSystemPrompt.mockImplementation(actual.normalizeSystemPrompt);
  return { normalizeSystemPrompt: testContext.normalizeSystemPrompt };
});

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

describe('importService', () => {
  beforeEach(() => {
    testContext.storeState.chats = [createChat('existing-chat', 'Existing')];
    testContext.storeState.folders = {};
    testContext.storeState.contentStore = {};
    testContext.storeState.apiKey = 'existing-key';
    testContext.storeState.theme = 'light';
    testContext.storeState.currentChatIndex = 0;
    testContext.storeState.branchClipboard = null;
    testContext.storeState.evaluationResults = {};
    testContext.storeState.evaluationSettings = { safetyPreSend: 'manual', safetyPostReceive: 'manual', qualityPreSend: 'manual', qualityPostReceive: 'manual' };
    testContext.storeState.branchHistoryPast = [];
    testContext.storeState.branchHistoryFuture = [];
    testContext.storeState.providerCustomModels = {};
    testContext.setChats.mockClear();
    testContext.setFolders.mockClear();
    testContext.setCurrentChatIndex.mockClear();
    testContext.setState.mockReset();
    testContext.setState.mockImplementation((patch) => Object.assign(testContext.storeState, patch));
    testContext.saveChatData.mockReset();
    testContext.saveChatData.mockResolvedValue(undefined);
    testContext.setLocalStorageItem.mockClear();
    testContext.normalizeSystemPrompt.mockClear();
    testContext.toastInfo.mockClear();
    testContext.toastWarning.mockClear();
    testContext.importOpenAIChatExportMock.mockReset();
    testContext.createPartializedState.mockClear();
    testContext.invalidateAiTasks.mockReset();
    vi.mocked(window.confirm).mockReset();
  });

  it('leaves live state untouched when import format is unrecognized', async () => {
    const file = new File([JSON.stringify({ foo: 'bar' })], 'import.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result).toEqual({
      success: false,
      message: 'notifications.unrecognisedDataFormat',
    });
    expect(testContext.storeState.chats).toEqual([createChat('existing-chat', 'Existing')]);
    expect(testContext.setState).not.toHaveBeenCalled();
  });

  it('does not roll back edits made while the import file is being read', async () => {
    let finishRead!: (text: string) => void;
    const originalFileReader = globalThis.FileReader;
    class DeferredFileReader {
      public onload: ((event: { target: { result: string } }) => void) | null = null;
      readAsText() {
        finishRead = (text) => this.onload?.({ target: { result: text } });
      }
    }
    Object.defineProperty(globalThis, 'FileReader', {
      value: DeferredFileReader,
      configurable: true,
    });
    testContext.normalizeSystemPrompt.mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.mocked(window.confirm).mockReturnValue(false);

    try {
      const pending = importChatFromFile(
        new File([JSON.stringify({ version: 1, folders: {}, chats: [createChat('imported')] })], 'slow.json'),
        t,
      );
      testContext.storeState.theme = 'changed-during-read';
      finishRead(JSON.stringify({ version: 1, folders: {}, chats: [createChat('imported')] }));

      await expect(pending).resolves.toEqual({
        success: false,
        message: 'notifications.quotaExceeded',
      });
      expect(testContext.storeState.theme).toBe('changed-during-read');
    } finally {
      Object.defineProperty(globalThis, 'FileReader', {
        value: originalFileReader,
        configurable: true,
      });
    }
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

  it('leaves live state untouched when quota retry is declined', async () => {
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
    expect(testContext.setState).not.toHaveBeenCalled();
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
    expect(testContext.invalidateAiTasks).toHaveBeenCalledWith();
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

    testContext.normalizeSystemPrompt
      .mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); })
      .mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    vi.mocked(window.confirm).mockReturnValue(true);

    const file = new File([JSON.stringify(exportV1)], 'quota-v1.json', {
      type: 'application/json',
    });

    const result = await importChatFromFile(file, t);

    expect(result.success).toBe(true);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(testContext.storeState.chats).toHaveLength(3);
    expect(testContext.setState).toHaveBeenCalledTimes(1);
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

  it.each([1, 2, 3])('commits version %s with its settings priority in one write', async (version) => {
    for (const mode of ['append', 'replace'] as const) {
      for (const includeSettings of [false, true]) {
        testContext.storeState.chats = [createChat('existing-chat', 'Existing')];
        const existing = testContext.storeState.chats[0];
        testContext.storeState.apiKey = 'existing-key';
        testContext.storeState.theme = 'light';
        const existingSettings = { safetyPreSend: 'manual', safetyPostReceive: 'manual', qualityPreSend: 'manual', qualityPostReceive: 'manual' };
        testContext.storeState.evaluationSettings = existingSettings;
        testContext.storeState.evaluationResults = { 'existing-chat:node:pre-send': { phase: 'pre-send' } };
        testContext.storeState.branchHistoryPast = [{ chats: [{ id: 'existing-chat' }] }];
        testContext.storeState.branchHistoryFuture = [];
        testContext.setState.mockClear();
        const importedSettings = { safetyPreSend: 'auto', safetyPostReceive: 'auto', qualityPreSend: 'auto', qualityPostReceive: 'auto' };
        const payload = { version, folders: {}, contentStore: {}, chats: [createChat('imported')],
          apiKey: 'file-secret', theme: 'file-theme', evaluationSettings: importedSettings,
          evaluationResults: { 'imported:node:pre-send': { phase: 'pre-send' } },
        };
        const result = await importChatFromFile(new File([JSON.stringify(payload)], 'priority.json'), t, mode, includeSettings);
        expect(result.success).toBe(true);
        expect(testContext.setState).toHaveBeenCalledTimes(1);
        const resetsSettings = mode === 'replace' && includeSettings;
        expect(testContext.storeState.apiKey).toBe(resetsSettings ? undefined : 'existing-key');
        expect(testContext.storeState.theme).toBe(resetsSettings ? 'dark' : 'light');
        if (version === 3 && resetsSettings) expect(testContext.storeState.evaluationSettings).toEqual(importedSettings);
        else if (!resetsSettings) expect(testContext.storeState.evaluationSettings).toEqual(existingSettings);
        if (mode === 'append') {
          expect(testContext.storeState.chats[1]).toBe(existing);
          expect(testContext.storeState.branchHistoryPast).toHaveLength(1);
        } else {
          expect(testContext.storeState.chats).toHaveLength(1);
          expect(testContext.storeState.branchHistoryPast).toEqual([]);
        }
        const results = testContext.storeState.evaluationResults as Record<string, unknown>;
        if (version === 3) expect(results[`${testContext.storeState.chats[0].id}:node:pre-send`]).toEqual({ phase: 'pre-send' });
      }
    }
  });

  it('rejects an edit made while a plan awaits commit without restoring old data', async () => {
    testContext.normalizeSystemPrompt.mockImplementationOnce(() => {
      queueMicrotask(() => { testContext.storeState.theme = 'new-edit'; });
    });
    const result = await importChatFromFile(new File([JSON.stringify([createChat('imported')])], 'edit.json'), t);
    expect(result).toEqual({ success: false, message: 'concurrent-change', status: 'concurrent-change' });
    expect(testContext.storeState.theme).toBe('new-edit');
    expect(testContext.storeState.chats[0].id).toBe('existing-chat');
    expect(testContext.setState).not.toHaveBeenCalled();
    expect(testContext.saveChatData).not.toHaveBeenCalled();
  });

  it('recaptures replace settings after AI cancellation finalizes state', async () => {
    testContext.invalidateAiTasks.mockImplementationOnce(() => { testContext.storeState.theme = 'finalized'; });
    const result = await importChatFromFile(new File([JSON.stringify([createChat('imported')])], 'finalize.json'), t, 'replace', false);
    expect(result.success).toBe(true);
    expect(testContext.storeState.theme).toBe('finalized');
    expect(testContext.setState).toHaveBeenCalledTimes(1);
  });

  it('keeps imported memory when post-commit persistence fails', async () => {
    testContext.saveChatData.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
    const result = await importChatFromFile(new File([JSON.stringify([createChat('imported')])], 'storage.json'), t, 'replace', false);
    expect(result).toEqual({ success: false, message: 'storage-error: quota', status: 'storage-error' });
    expect(testContext.storeState.chats).toHaveLength(1);
    expect(testContext.storeState.chats[0].id).not.toBe('existing-chat');
    expect(testContext.setState).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('leaves folders, content refs, chats and settings unchanged if conversion fails', async () => {
    const sharedContent = { content: [{ type: 'text', text: 'original' }], refCount: 2 };
    testContext.storeState.contentStore = { shared: sharedContent };
    const folder = { id: 'existing-folder', name: 'Existing', expanded: false, order: 1 };
    testContext.storeState.folders = { [folder.id]: folder };
    const originalChats = testContext.storeState.chats;
    testContext.normalizeSystemPrompt.mockImplementationOnce(() => { throw new Error('normalization failure'); });
    const payload = { version: 3, folders: { imported: { id: 'imported', name: 'Imported', expanded: false, order: 0 } },
      contentStore: { shared: { ...sharedContent, refCount: 1 } }, chats: [createChat('imported')],
    };
    const result = await importChatFromFile(new File([JSON.stringify(payload)], 'failed.json'), t);
    expect(result).toEqual({ success: false, message: 'normalization failure' });
    expect(testContext.storeState.chats).toBe(originalChats);
    expect(sharedContent.refCount).toBe(2);
    expect(folder.order).toBe(1);
    expect(testContext.storeState.apiKey).toBe('existing-key');
    expect(testContext.setState).not.toHaveBeenCalled();
  });


  it('converts every v2 branch on the detached content store', async () => {
    const payload = { version: 2, folders: {}, chats: [{ ...createChat('branched'),
      collapsedNodes: { root: true }, omittedNodes: { hidden: true }, protectedNodes: { root: true },
      branchTree: { rootId: 'root', activePath: ['root'], nodes: {
        root: { id: 'root', parentId: null, role: 'user', createdAt: 1, content: [{ type: 'text', text: 'root text' }] },
        hidden: { id: 'hidden', parentId: 'root', role: 'assistant', createdAt: 2, content: [{ type: 'reasoning', text: 'hidden reasoning' }] },
      } },
    }] };
    const result = await importChatFromFile(new File([JSON.stringify(payload)], 'branches.json'), t);
    expect(result.success).toBe(true);
    const nodes = testContext.storeState.chats[0].branchTree!.nodes;
    const content = testContext.storeState.contentStore[nodes.hidden.contentHash] as { content: unknown[] };
    expect(content.content).toEqual([{ type: 'reasoning', text: 'hidden reasoning' }]);
    expect(testContext.storeState.collapsedNodeMaps).toEqual({ '0': { root: true } });
    expect(testContext.storeState.omittedNodeMaps).toEqual({ '0': { hidden: true } });
    expect(testContext.storeState.protectedNodeMaps).toEqual({ '0': { root: true } });
    expect(testContext.setState).toHaveBeenCalledTimes(1);
    expect(testContext.setChats).not.toHaveBeenCalled();
    expect(testContext.setFolders).not.toHaveBeenCalled();
  });

  it('updates the append folder order without mutating the original folder object', async () => {
    const existingFolder = { id: 'existing', name: 'Existing', order: 0, expanded: false };
    testContext.storeState.folders = { existing: existingFolder };
    const result = await importChatFromFile(new File([JSON.stringify({ version: 1,
      folders: { imported: { id: 'imported', name: 'Imported', order: 0, expanded: false } },
      chats: [createChat('imported')],
    })], 'folders.json'), t);
    expect(result.success).toBe(true);
    expect(existingFolder.order).toBe(0);
    expect(testContext.storeState.folders.existing.order).toBe(1);
    expect(testContext.setState).toHaveBeenCalledTimes(1);
  });

});
