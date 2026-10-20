import { describe, expect, it } from 'vitest';

import type { ChatInterface, BranchNode, ContentInterface } from '@type/chat';
import type { ContentStoreData } from './contentStore';
import {
  addContent,
  addContentDelta,
  buildExportContentStore,
  resolveContent,
} from './contentStore';
import { flatChatToBranchTree } from './branchUtils';
import { selectBubbleSummary } from './bubbleSummaryOperations';
import { prepareChatForExport } from './chatExport';

const text = (t: string): ContentInterface[] => [{ type: 'text', text: t }];
const L = 'This is a fairly long text that simulates a real chat message with enough content to make delta compression worthwhile. It contains multiple sentences.';
const lt = (suffix: string): ContentInterface[] => [{ type: 'text', text: L + suffix }];

describe('prepareChatForExport', () => {
  it('retains flat summary references through branch normalization and export', () => {
    const chat: ChatInterface = {
      id: 'flat-summary',
      title: 'Flat summary',
      config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0, stream: true },
      titleSet: false,
      imageDetail: 'auto',
      messages: [
        { role: 'user', content: text('first') },
        { role: 'assistant', content: text('second') },
      ],
      summaryTargets: { '0': true, '1': false, invalid: true },
    };
    const selected = selectBubbleSummary(chat, ['0', '1'], 'range', '1', undefined, chat.config, {
      favoriteModels: [], providers: {}, fallbackProvider: { endpoint: 'https://example.test/v1/chat/completions' },
    }, 'saved', 1);
    chat.summaries = [{ ...selected.summary, text: 'saved summary', useForSubmit: true }, {
      id: 'invalid', mode: 'single', useForSubmit: false, text: 'invalid source',
      sources: [{ nodeId: '1', parentId: '0', role: 'user', textParts: ['stale source'] }],
    }];
    const summaryMetadata = { futureSummary: { version: 4 } };
    const sourceMetadata = { futureSource: { retained: true } };
    Object.assign(chat.summaries![0], summaryMetadata);
    Object.assign(chat.summaries![0].sources[1], sourceMetadata);
    const store: ContentStoreData = {};

    flatChatToBranchTree(chat, store);

    const [first, second] = chat.branchTree!.activePath;
    expect(chat.summaryTargets).toEqual({ [first]: true, [second]: false, invalid: true });
    expect(chat.summaries![0]).toMatchObject({
      id: 'saved', mode: 'range', useForSubmit: true, text: 'saved summary',
      ...summaryMetadata,
      sources: [
        { nodeId: first, parentId: null, role: 'user', textParts: ['first'] },
        { nodeId: second, parentId: first, role: 'assistant', textParts: ['second'], ...sourceMetadata },
      ],
    });
    expect(chat.summaries![1]).toEqual({
      id: 'invalid', mode: 'single', useForSubmit: false, text: 'invalid source',
      sources: [{ nodeId: second, parentId: '0', role: 'user', textParts: ['stale source'] }],
    });

    const exported = prepareChatForExport(chat, store).chat;
    expect(exported.summaryTargets).toEqual({ [first]: true, [second]: false });
    expect(exported.summaries).toEqual([chat.summaries![0]]);
  });

  it('keeps only the currently visible branch when requested', () => {
    const chat: ChatInterface = {
      id: 'chat-1',
      title: 'Branchy',
      messages: [],
      config: {
        model: 'test-model',
        max_tokens: 1000,
        temperature: 1,
        presence_penalty: 0,
        top_p: 1,
        frequency_penalty: 0,
        stream: true,
      },
      titleSet: false,
      imageDetail: 'auto',
      collapsedNodes: {
        root: true,
        hidden: true,
      },
      omittedNodes: {
        shown: true,
        hidden: true,
      },
      protectedNodes: {
        root: true,
        hidden: true,
      },
      branchTree: {
        rootId: 'root',
        activePath: ['root', 'shown'],
        nodes: {
          root: {
            id: 'root',
            parentId: null,
            role: 'user',
            contentHash: 'hash-root',
            createdAt: 1,
          },
          shown: {
            id: 'shown',
            parentId: 'root',
            role: 'assistant',
            contentHash: 'hash-shared',
            createdAt: 2,
          },
          hidden: {
            id: 'hidden',
            parentId: 'root',
            role: 'assistant',
            contentHash: 'hash-shared',
            createdAt: 3,
          },
        },
      },
    };

    const contentStore: ContentStoreData = {
      'hash-root': {
        content: [{ type: 'text', text: 'hello' }],
        refCount: 1,
      },
      'hash-shared': {
        content: [{ type: 'text', text: 'visible reply' }],
        refCount: 2,
      },
    };

    const treeMetadata = { future: { delta: 'opaque future value' } };
    Object.assign(chat.branchTree!, { futureTree: treeMetadata });
    Object.assign(contentStore['hash-shared'], { futureEntry: { flags: [true] } });
    const before = structuredClone({ chat, contentStore });
    const prepared = prepareChatForExport(chat, contentStore, {
      visibleBranchOnly: true,
    });

    expect(prepared.chat.branchTree?.activePath).toEqual(['root', 'shown']);
    expect(Object.keys(prepared.chat.branchTree?.nodes ?? {})).toEqual(['root', 'shown']);
    expect(prepared.chat.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'visible reply' }] },
    ]);
    expect(prepared.chat.collapsedNodes).toEqual({ root: true });
    expect(prepared.chat.omittedNodes).toEqual({ shown: true });
    expect(prepared.chat.protectedNodes).toEqual({ root: true });
    expect(prepared.chat.branchTree).toHaveProperty('futureTree', treeMetadata);
    expect(Reflect.get(prepared.chat.branchTree!, 'futureTree')).not.toBe(treeMetadata);
    expect(prepared.contentStore).toEqual({
      'hash-root': {
        content: [{ type: 'text', text: 'hello' }],
        refCount: 1,
      },
      'hash-shared': {
        content: [{ type: 'text', text: 'visible reply' }],
        refCount: 1,
        futureEntry: { flags: [true] },
      },
    });
    expect({ chat, contentStore }).toEqual(before);
  });
});

// ─── Delta Export Tests ───

describe('buildExportContentStore delta resolution', () => {
  it('resolves delta entries to full content, no delta in output', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(''));
    const deltaHash = addContentDelta(store, lt(' exported'), baseHash);
    expect(store[deltaHash].delta).toBeDefined();

    const exported = buildExportContentStore(store);
    expect(exported[deltaHash].delta).toBeUndefined();
    expect(exported[deltaHash].content).toEqual(lt(' exported'));
    expect(exported[baseHash].delta).toBeUndefined();
  });
});

describe('prepareChatForExport with deltas', () => {
  it('includes only referenced hashes in exported contentStore', () => {
    const store: ContentStoreData = {};
    const h1 = addContent(store, text('used'));
    const h2 = addContent(store, text('unused'));

    const chat: ChatInterface = {
      id: 'c1',
      title: 'Test',
      config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0, stream: true },
      titleSet: false,
      imageDetail: 'auto',
      messages: [{ role: 'user', content: text('used') }],
      branchTree: {
        rootId: 'n0',
        activePath: ['n0'],
        nodes: {
          n0: { id: 'n0', parentId: null, role: 'user', contentHash: h1, createdAt: 0 },
        },
      },
    };

    const result = prepareChatForExport(chat, store);
    expect(result.contentStore[h1]).toBeDefined();
    expect(result.contentStore[h2]).toBeUndefined();
  });

  it.each([false, true])('resolves deltas and retains entry extensions with visibleBranchOnly=%s', visibleBranchOnly => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(''));
    const deltaHash = addContentDelta(store, lt(' for-export'), baseHash);
    const entryMetadata = { delta: 'opaque future value', flags: [true] };
    Object.assign(store[deltaHash], { futureEntry: entryMetadata });
    const before = structuredClone(store);

    const chat: ChatInterface = {
      id: 'c1',
      title: 'Test',
      config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0, stream: true },
      titleSet: false,
      imageDetail: 'auto',
      messages: [{ role: 'user', content: lt(' for-export') }],
      branchTree: {
        rootId: 'n0',
        activePath: ['n0'],
        nodes: {
          n0: { id: 'n0', parentId: null, role: 'user', contentHash: deltaHash, createdAt: 0 },
        },
      },
    };

    const result = prepareChatForExport(chat, store, { visibleBranchOnly });
    expect(result.contentStore[deltaHash]).not.toHaveProperty('delta');
    expect(result.contentStore[deltaHash].content).toEqual(lt(' for-export'));
    expect(result.contentStore[deltaHash]).toHaveProperty('futureEntry', entryMetadata);
    expect(Reflect.get(result.contentStore[deltaHash], 'futureEntry')).not.toBe(entryMetadata);
    expect(result.contentStore[deltaHash].refCount).toBe(1);
    expect(result.contentStore).not.toHaveProperty(baseHash);
    expect(store).toEqual(before);
  });
});

describe('V3 export → import round-trip with branching', () => {
  it('branching chat survives export and re-import with full content', () => {
    const store: ContentStoreData = {};
    const baseHash = addContent(store, lt(' msg1'));
    const deltaHash = addContentDelta(store, lt(' msg2'), baseHash);
    const altHash = addContent(store, lt(' alt'));

    const nodes: Record<string, BranchNode> = {
      n0: { id: 'n0', parentId: null, role: 'user', contentHash: baseHash, createdAt: 0 },
      n1: { id: 'n1', parentId: 'n0', role: 'assistant', contentHash: deltaHash, createdAt: 1 },
      n2: { id: 'n2', parentId: 'n0', role: 'assistant', contentHash: altHash, createdAt: 2 },
    };

    const chat: ChatInterface = {
      id: 'branching',
      title: 'Branch Test',
      config: { model: 'test', max_tokens: 100, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0, stream: true },
      titleSet: false,
      imageDetail: 'auto',
      messages: [
        { role: 'user', content: lt(' msg1') },
        { role: 'assistant', content: lt(' msg2') },
      ],
      branchTree: { rootId: 'n0', activePath: ['n0', 'n1'], nodes },
    };

    // Export
    const exported = prepareChatForExport(chat, store);
    const v3 = {
      chats: [exported.chat],
      contentStore: exported.contentStore,
      folders: {},
      version: 3,
    };

    // All content fully resolved
    for (const entry of Object.values(v3.contentStore)) {
      expect(entry.delta).toBeUndefined();
    }

    // All nodes resolvable
    const tree = v3.chats[0].branchTree!;
    for (const node of Object.values(tree.nodes)) {
      expect(v3.contentStore[node.contentHash]).toBeDefined();
      expect(v3.contentStore[node.contentHash].content.length).toBeGreaterThan(0);
    }

    // Branch structure preserved
    expect(Object.keys(tree.nodes)).toHaveLength(3);
    expect(tree.nodes['n1'].parentId).toBe('n0');
    expect(tree.nodes['n2'].parentId).toBe('n0');
  });
});
