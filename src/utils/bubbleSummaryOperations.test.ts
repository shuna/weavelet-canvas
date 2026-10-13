import { expect, it } from 'vitest';
import type { ChatInterface } from '@type/chat';
import { summaryOperation } from '../../shared/google-sync/bubbleSummary';

const chat = (): ChatInterface => ({ id: 'chat', title: 'Chat', titleSet: true, imageDetail: 'auto',
  config: { model: 'test-model', max_tokens: 1000, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  messages: ['Alpha', 'Beta'].map(text => ({ role: 'user', content: [{ type: 'text', text }] })),
  branchTree: { rootId: 'a', activePath: ['a', 'b'], nodes: {
    a: { id: 'a', parentId: null, role: 'user', contentHash: 'a', createdAt: 0 },
    b: { id: 'b', parentId: 'a', role: 'user', contentHash: 'b', createdAt: 1 },
  } }, summaryTargets: { a: true }, summaries: [] });
const call = (value: Record<string, unknown>) => JSON.parse(summaryOperation(JSON.stringify(value)));
const select = (value = chat()) => call({ operation: 'select', chat: value, sourceNodeIds: ['a', 'b'], mode: 'range', originNodeId: 'b',
  summaryId: 'new', now: 123, settings: { favoriteModels: [], providers: {}, fallbackProvider: { endpoint: 'https://example.test/v1/chat/completions' } } });

it('selects one source snapshot and describes the same valid range', () => {
  const value = chat();
  const selection = select(value);
  expect(selection.summary.sources.map((source: { nodeId: string }) => source.nodeId)).toEqual(['a', 'b']);
  expect(selection.promptMessage.content[0].text).toContain('Alpha');
  const described = call({ operation: 'describe', chat: value, nodeId: 'b', mode: 'range', originNodeId: 'b' });
  expect(described.sourceNodeIds).toEqual(['a']);
  expect(described.path[1]).toMatchObject({ nodeId: 'b', eligible: true, targeted: false });
});

it('plans the auxiliary nonstream request from native URL metadata without a URL global', () => {
  const value = chat(), selection = select(value);
  const originalURL = globalThis.URL;
  try {
    // JSC on the native host has no browser URL constructor.
    (globalThis as { URL?: typeof URL }).URL = undefined;
    const planned = call({ operation: 'plan', chat: value, selection, modelState: {},
      transport: { endpointURL: { protocol: 'https:', hostname: 'example.test' }, hasApiKey: true } });
    expect(planned.request.body.stream).toBe(false);
    expect(planned.request.body.messages[0]).toMatchObject({ role: 'user' });
  } finally { globalThis.URL = originalURL; }
});

it('keeps usage accounting when output ends at length or sources change', () => {
  const value = chat(), selection = select(value);
  const base = { chat: value, selection, responseText: 'Result', countTotalTokens: true,
    totalTokenUsed: { 'test-model': { promptTokens: 0, completionTokens: 0, imageTokens: 0, extra: 42 } } };
  const length = call({ operation: 'apply', ...base, finishReason: 'length' });
  expect(length.error).toContain('出力上限');
  expect(length.summary).toBeUndefined();
  expect(length.changes.some((change: { path: string[] }) => change.path[0] === 'totalTokenUsed')).toBe(true);
  const changed = chat(); changed.messages[0].content[0] = { type: 'text', text: 'Changed' };
  const stale = call({ operation: 'apply', ...base, chat: changed });
  expect(stale.error).toContain('原文や状態');
  expect(stale.summary).toBeUndefined();
  expect(stale.changes.every((change: { path: string[] }) => change.path[0] === 'totalTokenUsed')).toBe(true);
  const rawStale = call({ operation: 'apply', ...base, stale: true });
  expect(rawStale.error).toContain('原文や設定');
  expect(rawStale.changes.every((change: { path: string[] }) => change.path[0] === 'totalTokenUsed')).toBe(true);
});

it('applies summary choice without replacing unrelated summary fields', () => {
  const value = chat(), selection = select(value);
  const result = call({ operation: 'apply', chat: value, selection, responseText: 'Short', countTotalTokens: false });
  expect(result.summary).toMatchObject({ id: 'new', text: 'Short', useForSubmit: false });
  value.summaries = [{ ...result.summary, unknown: { keep: true } }];
  const use = call({ operation: 'mutate', chat: value, action: 'use', summaryId: 'new', use: true });
  expect(use.changes).toContainEqual({ op: 'set', path: ['summaries', 0, 'useForSubmit'], value: true });
  expect(use.changes.some((change: { path: string[] }) => change.path.includes('unknown'))).toBe(false);
});

it('toggles a target on a branchless chat with numeric Web node IDs', () => {
  const value = chat(); delete value.branchTree;
  const result = call({ operation: 'mutate', chat: value, action: 'target', nodeId: '0' });
  expect(result.changes).toContainEqual({ op: 'set', path: ['summaryTargets', '0'], value: true });
});
