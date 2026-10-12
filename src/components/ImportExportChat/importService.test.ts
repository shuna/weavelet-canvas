import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';
import type { ChatInterface, FolderCollection } from '@type/chat';
import { addContent, addContentDelta, computeContentHash, resolveContent, type ContentStoreData } from '@utils/contentStore';
import { flatMessagesToBranchTree } from '@utils/branchUtils';
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
    resolveLegacyRemoteSnapshot: vi.fn(),
    refreshLegacyRemoteMigration: vi.fn(),
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
vi.mock('@store/storage/IndexedDbStorage', () => ({ saveChatData: testContext.saveChatData, resolveLegacyRemoteSnapshot: testContext.resolveLegacyRemoteSnapshot }));
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

const { importChatFromFile, prepareImportPreview, importSelectedPreview, retryImportPreviewSave } = await import('./importService');

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
    testContext.storeState.multiViewChatIndices = [];
    testContext.storeState.multiViewPrimaryChatIndex = null;
    testContext.storeState.pendingChatFocus = null;
    testContext.storeState.compareTarget = null;
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
    testContext.resolveLegacyRemoteSnapshot.mockReset();
    testContext.resolveLegacyRemoteSnapshot.mockResolvedValue(true);
    testContext.refreshLegacyRemoteMigration.mockReset();
    testContext.refreshLegacyRemoteMigration.mockResolvedValue(undefined);
    testContext.storeState.refreshLegacyRemoteMigration = testContext.refreshLegacyRemoteMigration;
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
    const importFolder = testContext.storeState.folders[testContext.storeState.chats[0].folder!];
    expect(importFolder.name).toBe('preview.importFolderName');
    expect(importFolder.parentId).toBeUndefined();
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


  it('imports the exported raw version 17 snapshot through the compatible hashed-tree converter', async () => {
    const chat = createChat('old', 'Old sync chat');
    const raw = { version: 17, state: { chats: [{ ...chat, messages: undefined,
      branchTree: { rootId: 'old-node', activePath: ['old-node'], nodes: {
        'old-node': { id: 'old-node', parentId: null, role: 'user', contentHash: 'old-content', createdAt: 1 },
      } },
    }], folders: {}, contentStore: { 'old-content': { content: [{ type: 'text', text: 'old text' }], refCount: 1 } } } };
    const fileRaw = JSON.parse(JSON.stringify(raw));
    const result = await importChatFromFile(new File([JSON.stringify(fileRaw)], 'old-remote.json'), t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats[0].messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'old text' }] }]);
    expect(testContext.resolveLegacyRemoteSnapshot).toHaveBeenCalledWith(fileRaw);
    expect(testContext.refreshLegacyRemoteMigration).toHaveBeenCalledTimes(1);
    expect(testContext.setState).toHaveBeenCalledTimes(1);
  });

  it('retains the raw record until primary persistence succeeds and leaves unrelated imports alone', async () => {
    const raw = { version: 17, state: { chats: [createChat('old')], folders: {} } };
    let finishSave!: () => void;
    testContext.saveChatData.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    const pending = importChatFromFile(new File([JSON.stringify(raw)], 'raw.json'), t);
    await vi.waitFor(() => expect(testContext.saveChatData).toHaveBeenCalledTimes(1));
    expect(testContext.resolveLegacyRemoteSnapshot).not.toHaveBeenCalled();
    finishSave();
    expect((await pending).success).toBe(true);
    expect(testContext.resolveLegacyRemoteSnapshot).toHaveBeenCalledWith(raw);
    testContext.resolveLegacyRemoteSnapshot.mockClear();
    await importChatFromFile(new File([JSON.stringify([createChat('ordinary')])], 'ordinary.json'), t);
    expect(testContext.resolveLegacyRemoteSnapshot).not.toHaveBeenCalled();
  });

  it('retains the raw record if imported primary persistence fails', async () => {
    testContext.saveChatData.mockRejectedValueOnce(new Error('disk failed'));
    const raw = { version: 17, state: { chats: [createChat('old')], folders: {} } };
    const result = await importChatFromFile(new File([JSON.stringify(raw)], 'raw.json'), t);
    expect(result.status).toBe('storage-error');
    expect(testContext.resolveLegacyRemoteSnapshot).not.toHaveBeenCalled();
  });

  it('rejects future raw schemas and corrupted raw references without changing live data or resolving recovery', async () => {
    for (const raw of [
      { version: 19, state: { chats: [createChat('future')], folders: {} } },
      { version: 17, state: { chats: [{ ...createChat('broken'), messages: undefined,
        branchTree: { rootId: 'node', activePath: ['node'], nodes: { node: { id: 'node', contentHash: 'missing' } } },
      }], contentStore: {}, folders: {} } },
    ]) {
      const result = await importChatFromFile(new File([JSON.stringify(raw)], 'invalid.json'), t);
      expect(result.success).toBe(false);
    }
    expect(testContext.setState).not.toHaveBeenCalled();
    expect(testContext.resolveLegacyRemoteSnapshot).not.toHaveBeenCalled();
  });


  it('delegates inline legacy branch content to the v2 converter', async () => {
    const raw = { version: 12, state: { chats: [{ ...createChat('inline'), messages: undefined,
      branchTree: { rootId: 'node', activePath: ['node', 'hashed'], nodes: {
        node: { id: 'node', parentId: null, role: 'user', content: [{ type: 'text', text: 'inline text' }], createdAt: 1 },
        hashed: { id: 'hashed', parentId: 'node', role: 'assistant', contentHash: 'stored-hash', createdAt: 2 },
      } },
    }], folders: {}, contentStore: { 'stored-hash': { content: [{ type: 'text', text: 'hashed text' }], refCount: 1 } } } };
    const result = await importChatFromFile(new File([JSON.stringify(raw)], 'inline-remote.json'), t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats[0].messages[0].content).toEqual([{ type: 'text', text: 'inline text' }]);
    expect(testContext.storeState.chats[0].messages[1].content).toEqual([{ type: 'text', text: 'hashed text' }]);
    expect(testContext.resolveLegacyRemoteSnapshot).toHaveBeenCalled();
  });

  it('retains the complete raw recovery record when a reduced import succeeds', async () => {
    const raw = { version: 17, state: { chats: [createChat('first'), createChat('second')], folders: {} } };
    testContext.normalizeSystemPrompt
      .mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); })
      .mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    vi.mocked(window.confirm).mockReturnValue(true);
    const result = await importChatFromFile(new File([JSON.stringify(raw)], 'reduced-remote.json'), t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats).toHaveLength(2);
    expect(testContext.resolveLegacyRemoteSnapshot).not.toHaveBeenCalled();
  });

  it('previews legacy files without touching live state or persistence and keeps source separate', async () => {
    const before = JSON.stringify(testContext.storeState);
    const source = await prepareImportPreview(new File([JSON.stringify([createChat('preview')])], 'preview.json'), t);
    expect(source.chats).toHaveLength(1);
    expect(source.chats[0].branchTree).toBeDefined();
    expect(source.chats[0].id).not.toBe('preview');
    expect(JSON.stringify(testContext.storeState)).toBe(before);
    expect(testContext.setState).not.toHaveBeenCalled();
    expect(testContext.saveChatData).not.toHaveBeenCalled();
    expect(testContext.invalidateAiTasks).not.toHaveBeenCalled();
    expect(testContext.resolveLegacyRemoteSnapshot).not.toHaveBeenCalled();
    expect(testContext.setLocalStorageItem).not.toHaveBeenCalled();
  });

  it('selectively imports all branches, resolves external delta bases, remaps collisions and preserves the latest workspace', async () => {
    const store: ContentStoreData = {};
    const longText = 'a long message '.repeat(100);
    const baseHash = addContent(store, [{ type: 'text', text: longText }]);
    const deltaContent = [{ type: 'text' as const, text: longText + ' changed' }];
    const deltaHash = addContentDelta(store, deltaContent, baseHash);
    expect(store[deltaHash].delta).toBeDefined();
    const chat = createChat('selected');
    chat.folder = 'folder';
    chat.branchTree = { rootId: 'root', activePath: ['root'], nodes: {
      root: { id: 'root', parentId: null, role: 'user', createdAt: 1, contentHash: deltaHash },
      hidden: { id: 'hidden', parentId: 'root', role: 'assistant', createdAt: 2, contentHash: deltaHash },
    } };
    const skipped = createChat('skip');
    skipped.folder = 'unselected-folder';
    skipped.branchTree = flatMessagesToBranchTree(skipped.messages, store);
    const source = await prepareImportPreview(new File([JSON.stringify({ version: 3,
      chats: [chat, skipped], contentStore: store,
      folders: { folder: { id: 'folder', name: 'Selected', order: 0, expanded: false },
        'unselected-folder': { id: 'unselected-folder', name: 'Skipped', order: 1, expanded: false } },
      evaluationResults: { 'selected:root:pre-send': { phase: 'pre-send' }, 'skip:other:pre-send': { phase: 'pre-send' } },
    })], 'delta.json'), t);
    const selectedId = source.chats[0].id;
    const sourceJson = JSON.stringify(source);
    const existing = testContext.storeState.chats[0];
    existing.title = 'Edited after preview';
    const history = [{ chats: [existing] }];
    testContext.storeState.branchHistoryPast = history;
    testContext.storeState.folders = { folder: { id: 'folder', name: 'Live', order: 0, expanded: true } };
    // Force a content hash collision, which must keep the original entry intact.
    const collision = { content: [{ type: 'text' as const, text: 'different' }], refCount: 3 };
    testContext.storeState.contentStore = { [computeContentHash(deltaContent)]: collision };
    const result = await importSelectedPreview(source, [selectedId], t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats).toHaveLength(2);
    const imported = testContext.storeState.chats[0];
    expect(imported.id).not.toBe(selectedId);
    expect(imported.folder).not.toBe('folder');
    expect(Object.values(testContext.storeState.folders).map(folder => folder.name).sort()).toEqual(['Live', 'Selected', 'preview.importFolderName']);
    expect(Object.keys(imported.branchTree!.nodes)).toEqual(['root', 'hidden']);
    const targetStore = testContext.storeState.contentStore as ContentStoreData;
    const importedHash = imported.branchTree!.nodes.hidden.contentHash;
    expect(importedHash).not.toBe(computeContentHash(deltaContent));
    expect(targetStore[importedHash].refCount).toBe(2);
    expect(resolveContent(targetStore, importedHash)).toEqual(deltaContent);
    expect(targetStore[baseHash]).toBeUndefined();
    expect(collision.refCount).toBe(3);
    expect(testContext.storeState.chats[1]).toBe(existing);
    expect(testContext.storeState.chats[1].title).toBe('Edited after preview');
    expect(testContext.storeState.currentChatIndex).toBe(1);
    expect(testContext.storeState.branchHistoryPast).toBe(history);
    expect(testContext.storeState.evaluationResults).toEqual({ [`${imported.id}:root:pre-send`]: { phase: 'pre-send' } });
    expect(testContext.storeState.apiKey).toBe('existing-key');
    expect(JSON.stringify(source)).toBe(sourceJson);
  });

  it('rejects corrupt nonactive branch content, circular parents/deltas and streaming references without committing', async () => {
    const store: ContentStoreData = {};
    const chat = createChat('invalid');
    chat.branchTree = flatMessagesToBranchTree(chat.messages, store);
    const root = chat.branchTree.nodes[chat.branchTree.rootId];
    const invalids = [
      { ...chat, branchTree: { ...chat.branchTree, nodes: { ...chat.branchTree.nodes,
        hidden: { ...root, id: 'hidden', parentId: root.id, contentHash: 'missing' } } } },
      { ...chat, branchTree: { ...chat.branchTree, nodes: { ...chat.branchTree.nodes,
        hidden: { ...root, id: 'hidden', parentId: 'hidden' } } } },
      { ...chat, branchTree: { ...chat.branchTree, nodes: { [root.id]: { ...root, contentHash: '__streaming:["live","node"]' } } } },
    ];
    for (const invalid of invalids) {
      await expect(prepareImportPreview(new File([JSON.stringify({ version: 3,
        chats: [invalid], folders: {}, contentStore: store,
      })], 'invalid.json'), t)).rejects.toThrow();
    }
    const streamingHash = '__streaming:["live","node"]';
    await expect(prepareImportPreview(new File([JSON.stringify({ version: 3, chats: [invalids[2]], folders: {},
      contentStore: { ...store, [streamingHash]: { content: [], refCount: 1 } },
    })], 'streaming.json'), t)).rejects.toThrow('Streaming content');
    const cyclicStore = { ...store, [root.contentHash]: { content: [], refCount: 1,
      delta: { baseHash: root.contentHash, patches: '' } } };
    await expect(prepareImportPreview(new File([JSON.stringify({ version: 3,
      chats: [chat], folders: {}, contentStore: cyclicStore,
    })], 'cyclic.json'), t)).rejects.toThrow();
    expect(testContext.setState).not.toHaveBeenCalled();
    expect(testContext.saveChatData).not.toHaveBeenCalled();
  });

  it('rejects empty/unknown selections and retries committed save failures without duplicating chats', async () => {
    const source = await prepareImportPreview(new File([JSON.stringify([createChat('preview')])], 'preview.json'), t);
    expect((await importSelectedPreview(source, [], t)).success).toBe(false);
    expect((await importSelectedPreview(source, ['unknown'], t)).success).toBe(false);
    expect(testContext.setState).not.toHaveBeenCalled();
    testContext.saveChatData.mockRejectedValueOnce(new Error('disk full'));
    expect((await importSelectedPreview(source, [source.chats[0].id], t)).status).toBe('storage-error');
    const chats = testContext.storeState.chats;
    expect(chats).toHaveLength(2);
    expect((await retryImportPreviewSave(t)).success).toBe(true);
    expect(testContext.storeState.chats).toBe(chats);
    expect(testContext.setState).toHaveBeenCalledTimes(1);
    expect(testContext.saveChatData).toHaveBeenCalledTimes(2);
  });

  it('keeps the selected live chat when ordinary append inserts chats before it', async () => {
    const result = await importChatFromFile(new File([JSON.stringify([createChat('new')])], 'append.json'), t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.currentChatIndex).toBe(1);
    expect(testContext.storeState.chats[testContext.storeState.currentChatIndex].id).toBe('existing-chat');
  });

  it.each([false, true])('selects and persists the first selectively imported chat when live selection is absent (empty=%s)', async (empty) => {
    const source = await prepareImportPreview(new File([JSON.stringify([createChat('preview')])], 'preview.json'), t);
    if (empty) testContext.storeState.chats = [];
    testContext.storeState.currentChatIndex = -1;
    const result = await importSelectedPreview(source, [source.chats[0].id], t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.currentChatIndex).toBe(0);
    expect(testContext.storeState.chats[0].title).toBe(source.chats[0].title);
    expect(testContext.setLocalStorageItem).toHaveBeenCalledWith('currentChatIndex', '0');
    expect(testContext.saveChatData).toHaveBeenCalledTimes(1);
  });

  it.each(['selective', 'ordinary'])('keeps positional view references on the latest live chats after %s append', async (mode) => {
    const source = await prepareImportPreview(new File([JSON.stringify([createChat('preview')])], 'preview.json'), t);
    const first = testContext.storeState.chats[0];
    const latest = createChat('latest', 'Added during preview');
    testContext.storeState.chats = [latest, first];
    testContext.storeState.currentChatIndex = 1;
    testContext.storeState.multiViewChatIndices = [0, 1];
    testContext.storeState.multiViewPrimaryChatIndex = 1;
    testContext.storeState.pendingChatFocus = { chatIndex: 0, nodeId: 'focus-node' };
    testContext.storeState.compareTarget = { chatIndex: 1, nodeId: 'compare-node' };
    const history = [{ chats: [first] }];
    testContext.storeState.branchHistoryPast = history;
    const result = mode === 'selective' ? await importSelectedPreview(source, [source.chats[0].id], t)
      : await importChatFromFile(new File([JSON.stringify([createChat('ordinary')])], 'ordinary.json'), t);
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats[1]).toBe(latest);
    expect(testContext.storeState.chats[2]).toBe(first);
    expect(testContext.storeState.multiViewChatIndices).toEqual([1, 2]);
    expect(testContext.storeState.multiViewPrimaryChatIndex).toBe(2);
    expect(testContext.storeState.pendingChatFocus).toEqual({ chatIndex: 1, nodeId: 'focus-node' });
    expect(testContext.storeState.compareTarget).toEqual({ chatIndex: 2, nodeId: 'compare-node' });
    expect(testContext.storeState.branchHistoryPast).toBe(history);
  });

  it('rejects OpenAI parent/child cycles, missing references and invalid current_node before conversion', async () => {
    const message = { author: { role: 'user' }, content: { parts: ['valid message'] } };
    const root = { id: 'r', parent: null, children: ['a'], message: null };
    const child = { id: 'a', parent: 'r', children: [], message };
    const invalids = [
      { mapping: { r: root, a: { ...child, parent: 'a' } }, current_node: 'a' },
      { mapping: { r: root, a: { ...child, children: ['r'] } }, current_node: 'a' },
      { mapping: { r: root, a: { ...child, parent: 'missing' } }, current_node: 'a' },
      { mapping: { r: { ...root, children: ['missing'] }, a: child }, current_node: 'a' },
      { mapping: { r: root, a: child }, current_node: 'missing' },
    ];
    for (const invalid of invalids) {
      for (const payload of [invalid, [invalid]]) {
        await expect(prepareImportPreview(new File([JSON.stringify(payload)], 'invalid-openai.json'), t)).rejects.toThrow();
      }
    }
    expect(testContext.importOpenAIChatExportMock).not.toHaveBeenCalled();
    expect(testContext.setState).not.toHaveBeenCalled();
    expect(testContext.saveChatData).not.toHaveBeenCalled();
    expect(testContext.invalidateAiTasks).not.toHaveBeenCalled();
  });

  it('imports exact mixed chat/folder selection plus only folder ancestors under one fresh root', async () => {
    const folders = {
      parent: { id: 'parent', name: 'Parent', order: 0, expanded: true },
      nested: { id: 'nested', name: 'Nested', order: 0, expanded: true, parentId: 'parent' },
      empty: { id: 'empty', name: 'Empty', order: 1, expanded: false, parentId: 'parent' },
      unrelated: { id: 'unrelated', name: 'Unrelated', order: 2, expanded: false, parentId: 'parent' },
    };
    const chosen = { ...createChat('chosen', 'Chosen'), folder: 'nested' };
    const unchecked = { ...createChat('unchecked', 'Unchecked sibling'), folder: 'nested' };
    const unfiled = createChat('unfiled', 'Unfiled');
    const source = await prepareImportPreview(new File([JSON.stringify({ version: 3,
      chats: [chosen, unchecked, unfiled], folders, contentStore: {},
    })], 'nested.json'), t);
    const before = JSON.stringify(source);
    const liveRoot = { id: 'parent', name: 'Live root', order: 4, expanded: false };
    const liveChild = { id: 'nested', name: 'Live child', order: 7, expanded: true, parentId: 'parent' };
    testContext.storeState.folders = { parent: liveRoot, nested: liveChild };
    const namedT = (key: string, opts?: Record<string, unknown>) => key === 'preview.importFolderName'
      ? `Import: ${opts?.fileName}` : key;
    const result = await importSelectedPreview(source, [source.chats[0].id, source.chats[2].id], namedT,
      { fileName: 'nested.json', selectedFolderIds: ['nested', 'empty'] });
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats.map(chat => chat.title)).toEqual(['Chosen', 'Unfiled', 'Existing']);
    const merged = Object.values(testContext.storeState.folders);
    expect(merged.map(folder => folder.name).sort()).toEqual(['Empty', 'Import: nested.json', 'Live child', 'Live root', 'Nested', 'Parent']);
    const importedRoot = merged.find(folder => folder.name === 'Import: nested.json')!;
    const importedParent = merged.find(folder => folder.name === 'Parent')!;
    const importedNested = merged.find(folder => folder.name === 'Nested')!;
    const importedEmpty = merged.find(folder => folder.name === 'Empty')!;
    expect(importedRoot.expanded).toBe(true);
    expect(importedRoot.order).toBe(0);
    expect(importedParent.id).not.toBe('parent');
    expect(importedParent.parentId).toBe(importedRoot.id);
    expect(importedNested.parentId).toBe(importedParent.id);
    expect(importedEmpty.parentId).toBe(importedParent.id);
    expect(testContext.storeState.chats[0].folder).toBe(importedNested.id);
    expect(testContext.storeState.chats[1].folder).toBe(importedRoot.id);
    expect(testContext.storeState.folders.parent.name).toBe('Live root');
    expect(testContext.storeState.folders.parent.order).toBe(5);
    expect(testContext.storeState.folders.nested.order).toBe(7);
    expect(testContext.storeState.folders.nested).toBe(liveChild);
    expect(testContext.storeState.folders.parent).not.toBe(liveRoot);
    expect(liveRoot.order).toBe(4);
    expect(liveChild.order).toBe(7);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each([1, 2, 3])('supports version %s empty-folder-only preview and selected folder import', async (version) => {
    const payload = { version, chats: [], contentStore: {}, folders: {
      parent: { id: 'parent', name: 'Parent', order: 0, expanded: true },
      empty: { id: 'empty', name: 'Empty', order: 0, expanded: false, parentId: 'parent' },
      skip: { id: 'skip', name: 'Skipped', order: 1, expanded: false, parentId: 'parent' },
    } };
    const source = await prepareImportPreview(new File([JSON.stringify(payload)], 'empty-folders.json'), t);
    expect(source.chats).toEqual([]);
    expect(testContext.setState).not.toHaveBeenCalled();
    const result = await importSelectedPreview(source, [], t,
      { fileName: 'empty-folders.json', selectedFolderIds: ['empty'] });
    expect(result.success).toBe(true);
    expect(testContext.storeState.chats).toHaveLength(1);
    expect(Object.values(testContext.storeState.folders).map(folder => folder.name).sort())
      .toEqual(['Empty', 'Parent', 'preview.importFolderName']);
    expect(testContext.storeState.currentChatIndex).toBe(0);
  });

  it('rejects entirely empty files and unknown or empty folder selections', async () => {
    const emptyPayload = { version: 3, chats: [], folders: {}, contentStore: {} };
    await expect(prepareImportPreview(new File([JSON.stringify(emptyPayload)], 'empty.json'), t)).rejects.toThrow();
    const source = await prepareImportPreview(new File([JSON.stringify({ ...emptyPayload,
      folders: { empty: { id: 'empty', name: 'Empty', order: 0, expanded: false } },
    })], 'folder.json'), t);
    for (const selectedFolderIds of [[], ['missing'], ['constructor']]) {
      const result = await importSelectedPreview(source, [], t, { fileName: 'folder.json', selectedFolderIds });
      expect(result.success).toBe(false);
    }
    expect(testContext.setState).not.toHaveBeenCalled();
  });

  it.each(['append', 'replace'] as const)('keeps nested folder metadata during normal %s with colliding live ids', async (mode) => {
    const payload = { version: 3, contentStore: {}, chats: [{ ...createChat('nested-chat'), folder: 'nested' }], folders: {
      parent: { id: 'parent', name: 'File parent', order: 0, expanded: true },
      nested: { id: 'nested', name: 'File nested', order: 0, expanded: false, parentId: 'parent' },
      empty: { id: 'empty', name: 'File empty', order: 1, expanded: false, parentId: 'parent' },
    } };
    testContext.storeState.folders = { parent: { id: 'parent', name: 'Live parent', order: 0, expanded: false },
      nested: { id: 'nested', name: 'Live nested', order: 8, expanded: true, parentId: 'parent' } };
    const result = await importChatFromFile(new File([JSON.stringify(payload)], 'normal-nested.json'), t, mode, false);
    expect(result.success).toBe(true);
    const folders = Object.values(testContext.storeState.folders);
    const parent = folders.find(folder => folder.name === 'File parent')!;
    const nested = folders.find(folder => folder.name === 'File nested')!;
    expect(nested.parentId).toBe(parent.id);
    expect(folders.find(folder => folder.name === 'File empty')!.parentId).toBe(parent.id);
    expect(testContext.storeState.chats[0].folder).toBe(nested.id);
    if (mode === 'append') {
      expect(parent.id).not.toBe('parent');
      expect(parent.parentId).toBe(folders.find(folder => folder.name === 'preview.importFolderName')!.id);
      expect(testContext.storeState.folders.parent.name).toBe('Live parent');
      expect(testContext.storeState.folders.nested.order).toBe(8);
    } else {
      expect(parent.id).toBe('parent');
      expect(parent.parentId).toBeUndefined();
      expect(folders).toHaveLength(3);
    }
  });

  it('rejects missing or cyclic folder parents before a preview or append commits', async () => {
    for (const folders of [
      { folder: { id: 'folder', name: 'Folder', order: 0, expanded: false, parentId: 'missing' } },
      { folder: { id: 'folder', name: 'Folder', order: 0, expanded: false, parentId: 'folder' } },
    ]) {
      const file = new File([JSON.stringify({ version: 3, chats: [createChat('chat')], folders, contentStore: {} })], 'bad-folder.json');
      await expect(prepareImportPreview(file, t)).rejects.toThrow();
      expect((await importChatFromFile(file, t)).success).toBe(false);
    }
    expect(testContext.setState).not.toHaveBeenCalled();
    expect(testContext.saveChatData).not.toHaveBeenCalled();
  });

});
