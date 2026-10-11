import { expect, it, vi } from 'vitest';
import { addContent } from '@utils/contentStore';
import type { ChatInterface, MessageInterface, BranchNode } from '@type/chat';
import { rebuildSyncedUsage } from './rebuildUsage';
vi.mock('@utils/messageUtils', () => ({ default: vi.fn(async (messages: MessageInterface[]) => messages.reduce((total, message) => total + message.content.reduce((size, part) => size + ('text' in part ? part.text.length : 0), 0), 0)) }));

it('recounts all branches once, deduplicates copied generations and queues missing verified usage locally', async () => {
  const contentStore = {};
  const node = (id: string, parentId: string | null, role: BranchNode['role'], text: string, openRouterObservation?: BranchNode['openRouterObservation']) => ({ id, parentId, role, contentHash: addContent(contentStore, [{ type: 'text', text }]), createdAt: 1, openRouterObservation });
  const chat: ChatInterface = { id: 'chat', title: 'Test', titleSet: true, messages: [], imageDetail: 'auto',
    config: { model: 'test', max_tokens: 10, temperature: 1, top_p: 1, presence_penalty: 0, frequency_penalty: 0 },
    branchTree: { rootId: 'root', activePath: ['root', 'one'], nodes: {
      root: node('root', null, 'user', 'ask'),
      one: node('one', 'root', 'assistant', 'response', { generationId: 'generation', promptTokens: 10, completionTokens: 20 }),
      two: node('two', 'root', 'assistant', 'reply'),
    } } };
  const local = { verifiedStats: {}, pendingVerifications: {} };
  const result = await rebuildSyncedUsage([chat, { ...chat, id: 'copy', branchTree: { ...chat.branchTree!, nodes: { root: chat.branchTree!.nodes.root, one: chat.branchTree!.nodes.one } } }], contentStore, local);
  expect(result.totalTokenUsed.test).toEqual({ promptTokens: 13, completionTokens: 25, imageTokens: 0 });
  expect(result.pendingVerifications['chat:::one']).toMatchObject({ generationId: 'generation', status: 'pending', attemptCount: 0 });
  expect(result.pendingVerifications['copy:::one']).toMatchObject({ generationId: 'generation' });
  expect(local).toEqual({ verifiedStats: {}, pendingVerifications: {} });
  const pending = { ...result.pendingVerifications['chat:::one'], status: 'failed' as const, nextAttemptAt: Number.MAX_SAFE_INTEGER };
  expect((await rebuildSyncedUsage([chat], contentStore, { verifiedStats: {}, pendingVerifications: { 'chat:::one': pending } })).pendingVerifications['chat:::one']).toEqual(pending);
});

it('uses locally verified counts and supports legacy messages without reusing a cumulative counter', async () => {
  const chat: ChatInterface = { id: 'legacy', title: 'Test', titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 10, temperature: 1, top_p: 1, presence_penalty: 0, frequency_penalty: 0 },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ask' }] }, { role: 'assistant', content: [{ type: 'text', text: 'reply' }] }] };
  const stats = { generationId: 'generation', model: 'old-model', promptTokens: 100, completionTokens: 200, nativePromptTokens: 100, nativeCompletionTokens: 200, totalCost: 0, cacheDiscount: null, fetchedAt: 1 };
  const result = await rebuildSyncedUsage([chat], {}, { verifiedStats: { 'legacy:::1': stats }, pendingVerifications: {} });
  expect(result.totalTokenUsed['old-model:::openrouter']).toEqual({ promptTokens: 100, completionTokens: 200, imageTokens: 0 });
  expect(result.verifiedStats['legacy:::1']).toEqual(stats);
  expect(result.pendingVerifications).toEqual({});
});
