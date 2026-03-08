import { describe, expect, it } from 'vitest';

import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';
import { DEFAULT_PROVIDERS } from './provider-config';
import { migrateV9, migrateV10, migrateV11 } from './migrate';

// ---------------------------------------------------------------------------
// v9 → v10: provider migration from flat apiKey/apiEndpoint
// ---------------------------------------------------------------------------
describe('migrateV9', () => {
  const baseState = () => ({
    apiEndpoint: '',
    apiKey: '',
    chats: [],
    imageDetail: _defaultImageDetail,
  });

  it('creates default providers when no key exists', () => {
    const state = baseState() as any;
    migrateV9(state);

    expect(state.providers).toBeDefined();
    expect(state.favoriteModels).toEqual([]);
    // No key should be set on any provider
    expect(state.providers.openrouter.apiKey).toBeUndefined();
    expect(state.providers.openai.apiKey).toBeUndefined();
  });

  it('assigns key to openrouter when endpoint contains openrouter', () => {
    const state = {
      ...baseState(),
      apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'sk-or-test-key',
    } as any;
    migrateV9(state);

    expect(state.providers.openrouter.apiKey).toBe('sk-or-test-key');
    expect(state.providers.openai.apiKey).toBeUndefined();
  });

  it('assigns key to openai when endpoint contains openai.com', () => {
    const state = {
      ...baseState(),
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'sk-openai-test',
    } as any;
    migrateV9(state);

    expect(state.providers.openai.apiKey).toBe('sk-openai-test');
    expect(state.providers.openrouter.apiKey).toBeUndefined();
  });

  it('defaults unknown endpoint key to openrouter', () => {
    const state = {
      ...baseState(),
      apiEndpoint: 'https://custom-proxy.example.com/v1',
      apiKey: 'sk-custom',
    } as any;
    migrateV9(state);

    expect(state.providers.openrouter.apiKey).toBe('sk-custom');
  });
});

// ---------------------------------------------------------------------------
// v10 → v11: no-op (branchTree lazily initialized)
// ---------------------------------------------------------------------------
describe('migrateV10', () => {
  it('is a no-op and does not throw', () => {
    const state = { chats: [] } as any;
    expect(() => migrateV10(state)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// v11 → v12: inline content → contentHash + contentStore
// ---------------------------------------------------------------------------
describe('migrateV11', () => {
  it('migrates inline content to contentStore hashes', () => {
    const state = {
      chats: [
        {
          branchTree: {
            nodes: {
              'n1': {
                id: 'n1',
                parentId: null,
                role: 'user',
                content: [{ type: 'text', text: 'hello' }],
                createdAt: 1,
              },
              'n2': {
                id: 'n2',
                parentId: 'n1',
                role: 'assistant',
                content: [{ type: 'text', text: 'world' }],
                createdAt: 2,
              },
            },
          },
        },
      ],
    } as any;

    migrateV11(state);

    // contentStore should be populated
    expect(state.contentStore).toBeDefined();
    const hashes = Object.keys(state.contentStore);
    expect(hashes.length).toBe(2);

    // Nodes should have contentHash, not content
    const n1 = state.chats[0].branchTree.nodes['n1'];
    const n2 = state.chats[0].branchTree.nodes['n2'];
    expect(n1.contentHash).toBeDefined();
    expect(n1.content).toBeUndefined();
    expect(n2.contentHash).toBeDefined();
    expect(n2.content).toBeUndefined();

    // contentStore should contain the original content
    expect(state.contentStore[n1.contentHash].content).toEqual([
      { type: 'text', text: 'hello' },
    ]);
    expect(state.contentStore[n2.contentHash].content).toEqual([
      { type: 'text', text: 'world' },
    ]);
  });

  it('skips nodes that already have contentHash', () => {
    const state = {
      chats: [
        {
          branchTree: {
            nodes: {
              'n1': {
                id: 'n1',
                parentId: null,
                role: 'user',
                contentHash: 'existing-hash',
                createdAt: 1,
              },
            },
          },
        },
      ],
    } as any;

    migrateV11(state);

    expect(state.chats[0].branchTree.nodes['n1'].contentHash).toBe('existing-hash');
  });

  it('handles chats without branchTree gracefully', () => {
    const state = {
      chats: [
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
      ],
    } as any;

    migrateV11(state);

    expect(state.contentStore).toEqual({});
  });

  it('deduplicates identical content across nodes', () => {
    const sameContent = [{ type: 'text', text: 'same' }];
    const state = {
      chats: [
        {
          branchTree: {
            nodes: {
              'n1': { id: 'n1', parentId: null, role: 'user', content: [...sameContent], createdAt: 1 },
              'n2': { id: 'n2', parentId: 'n1', role: 'user', content: [...sameContent], createdAt: 2 },
            },
          },
        },
      ],
    } as any;

    migrateV11(state);

    const n1 = state.chats[0].branchTree.nodes['n1'];
    const n2 = state.chats[0].branchTree.nodes['n2'];
    // Same content should produce same hash
    expect(n1.contentHash).toBe(n2.contentHash);
    // refCount should be 2
    expect(state.contentStore[n1.contentHash].refCount).toBe(2);
  });
});
