import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ExportV3 } from '@type/export';
import type { StoreState } from '@store/store';
import { createPartializedState, mergePersistedStoreState, type PersistedStoreState } from '@store/persistence';
import { STORE_VERSION } from '@store/version';
import { validateExportV3 } from './import';
import { buildExportContentStore } from './contentStore';
import { prepareChatForExport } from './chatExport';

const corpus = JSON.parse(readFileSync(
  new URL('../../tests/fixtures/web-native/io-corpus.json', import.meta.url), 'utf8'
)) as {
  fixtureVersion: number;
  exportV3: ExportV3;
  syncSnapshot: { version: number; state: PersistedStoreState & { xFixtureRoot?: unknown } };
};

// This independently listed inventory makes added or removed persistence roots visible.
const persistKeys = [
  'chats', 'apiKey', 'apiVersion', 'apiEndpoint', 'theme', 'autoTitle',
  'titleModel', 'titleProviderId', 'advancedMode', 'prompts', 'defaultChatConfig',
  'defaultSystemMessage', 'hideMenuOptions', 'hideSideMenu', 'folders', 'enterToSubmit',
  'inlineLatex', 'markdownMode', 'streamingMarkdownPolicy', 'totalTokenUsed', 'countTotalTokens',
  'displayChatSize', 'menuWidth', 'defaultImageDetail', 'animateBubbleNavigation', 'providers',
  'favoriteModels', 'branchClipboard', 'contentStore', 'providerModelCache', 'providerCustomModels',
  '_legacyCustomModels', 'onboardingCompleted', 'splitPanelRatio', 'splitPanelSwapped',
  'chatActiveView', 'proxyEnabled', 'proxyEndpoint', 'proxyAuthToken', 'showDebugPanel',
  'searchHistory', 'sidebarSearchHistory', 'chatFindHistory', 'verifiedStats',
  'pendingVerifications', 'evaluationSettings', 'safetyThresholds', 'qualityThresholds',
  'evaluationResults', 'localModelEnabled', 'localModels', 'favoriteLocalModelIds',
  'localModelExecutionMode', 'activeLocalModels', 'savedModelMeta',
];

describe('synthetic I/O corpus: preservation and explicit Web losses', () => {
  it('includes all 55 known persistence roots and a valid full V3 export', () => {
    expect(corpus.fixtureVersion).toBe(1);
    expect(corpus.syncSnapshot.version).toBe(STORE_VERSION);
    expect(persistKeys).toHaveLength(55);
    expect(Object.keys(corpus.syncSnapshot.state).sort()).toEqual([...persistKeys, 'xFixtureRoot'].sort());
    expect(validateExportV3(structuredClone(corpus.exportV3))).toBe(true);
    expect(corpus.exportV3.chats).toHaveLength(2);
    expect(corpus.exportV3.contentStore.rich.content.map((part) => part.type))
      .toEqual(['text', 'image_url', 'reasoning', 'tool_call', 'tool_result']);
  });

  it('serializes hydrated known state and unknown roots/nested extensions, omitting branched messages', () => {
    const input = structuredClone(corpus.syncSnapshot.state);
    const before = structuredClone(input);
    const expected = structuredClone(input);
    delete expected.chats![0].messages;
    const hydrated = mergePersistedStoreState(input as unknown as StoreState, input);
    const saved = createPartializedState(hydrated);
    expect(Object.keys(saved).sort()).toEqual([...persistKeys, 'xFixtureRoot'].sort());
    expect(JSON.parse(JSON.stringify(saved))).toEqual(expected);
    expect(input).toEqual(before);
  });

  it('exports all full contents and entry extensions', () => {
    const input = structuredClone(corpus.exportV3.contentStore);
    expect(buildExportContentStore(input)).toEqual(corpus.exportV3.contentStore);
    expect(input).toEqual(corpus.exportV3.contentStore);
  });

  it.each([false, true])('retains tree/entry extensions while applying visibleBranchOnly=%s', visibleBranchOnly => {
    const [branched, flat] = corpus.exportV3.chats!;
    const expectedChat = structuredClone(branched);
    if (visibleBranchOnly) {
      delete expectedChat.branchTree!.nodes['n-inactive'];
      delete expectedChat.collapsedNodes!['n-inactive'];
      delete expectedChat.omittedNodes!['n-inactive'];
      delete expectedChat.protectedNodes!['n-inactive'];
    }
    const prepared = prepareChatForExport(branched, corpus.exportV3.contentStore, { visibleBranchOnly });
    expect(prepared.chat).toEqual(expectedChat);
    expect(Object.keys(prepared.chat.branchTree!.nodes))
      .toEqual(visibleBranchOnly ? ['n-system', 'n-user', 'n-assistant'] : ['n-system', 'n-user', 'n-inactive', 'n-assistant']);
    expect(prepared.contentStore).toEqual({
      system: { ...corpus.exportV3.contentStore.system, refCount: 1 },
      rich: { ...corpus.exportV3.contentStore.rich, refCount: 1 },
      ...(visibleBranchOnly ? {} : { inactive: { ...corpus.exportV3.contentStore.inactive, refCount: 1 } }),
      answer: { ...corpus.exportV3.contentStore.answer, refCount: 1 },
    });
    expect(prepareChatForExport(flat, corpus.exportV3.contentStore))
      .toEqual({ chat: flat, contentStore: {} });
  });
});
