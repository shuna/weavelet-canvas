import { generationLiveUsage } from '../../shared/google-sync/usage';
import { describe, expect, it } from 'vitest';
import { _defaultChatConfig } from '@constants/chatDefaults';
import type { ChatInterface, MessageInterface } from '@type/chat';
import { generationObservation, generationUsage } from '../../shared/google-sync/usage';
import { prepareSubmitUsage } from './generationUsage';

const message = (role: MessageInterface['role'], text: string): MessageInterface =>
  ({ role, content: [{ type: 'text', text }] });
const chat = (): ChatInterface => ({
  id: 'chat', title: 'Chat', titleSet: true, imageDetail: 'auto',
  config: { ..._defaultChatConfig, model: 'model', providerId: 'openrouter', systemPrompt: 'instructions' },
  messages: [message('user', 'A'), message('assistant', 'B'), message('user', 'C'), message('assistant', 'D')],
  branchTree: { rootId: 'a', activePath: ['a', 'b', 'c', 'd'], nodes: {
    a: { id: 'a', parentId: null, role: 'user', contentHash: '', createdAt: 0 },
    b: { id: 'b', parentId: 'a', role: 'assistant', contentHash: '', createdAt: 0 },
    c: { id: 'c', parentId: 'b', role: 'user', contentHash: '', createdAt: 0 },
    d: { id: 'd', parentId: 'c', role: 'assistant', contentHash: '', createdAt: 0 },
  } }, omittedNodes: { c: true },
  summaries: [{ id: 's', mode: 'range', useForSubmit: true, text: 'A/B summary', sources: [
    { nodeId: 'a', parentId: null, role: 'user', textParts: ['A'] },
    { nodeId: 'b', parentId: 'a', role: 'assistant', textParts: ['B'] },
  ] }],
});
const call = (input: object) => JSON.parse(generationUsage(JSON.stringify(input)));

describe('generation usage shared with Web', () => {
  it('accepts tokenizer counts while retaining observed counter precedence', () => {
    const source = chat();
    const input = {chat: source, targetNodeId: 'd', countTotalTokens: true, totalTokenUsed: {}, counts: {promptTokens: 123, completionTokens: 45}};
    expect(call(input).changes).toContainEqual({op: 'set', path: ['totalTokenUsed', 'model:::openrouter'], value: {promptTokens: 123, completionTokens: 45, imageTokens: 0}});
    source.branchTree!.nodes.d.openRouterObservation = {promptTokens: 0, completionTokens: 0};
    expect(call(input).changes).toContainEqual({op: 'set', path: ['totalTokenUsed', 'model:::openrouter'], value: {promptTokens: 0, completionTokens: 0, imageTokens: 0}});
  });
  it('uses complete zero-valued observation and preserves image and unknown fields', () => {
    const source = chat();
    source.branchTree!.nodes.d.openRouterObservation = { promptTokens: 0, completionTokens: 0 };
    const result = call({ chat: source, targetNodeId: 'd', countTotalTokens: true,
      totalTokenUsed: { 'model:::openrouter': { promptTokens: 7, completionTokens: 8, imageTokens: 3, unknown: 'keep' },
        unrelated: { promptTokens: 1e20, completionTokens: 2, imageTokens: 0 } } });
    expect(result).toMatchObject({ usageKey: 'model:::openrouter', counterFields: ['promptTokens', 'completionTokens'], changes: [] });
    source.branchTree!.nodes.d.openRouterObservation = { promptTokens: 2, completionTokens: 4 };
    const updated = call({ chat: source, targetNodeId: 'd', countTotalTokens: true,
      totalTokenUsed: { 'model:::openrouter': { promptTokens: 7, completionTokens: 8, imageTokens: 3, unknown: 'keep' },
        unrelated: { promptTokens: 1e20, completionTokens: 2, imageTokens: 0 } } });
    expect(updated.changes).toEqual([
      { op: 'set', path: ['totalTokenUsed', 'model:::openrouter', 'promptTokens'], value: 9 },
      { op: 'set', path: ['totalTokenUsed', 'model:::openrouter', 'completionTokens'], value: 12 },
    ]);
  });

  it('counts the same summary and omitted context as the Web submit helper', () => {
    const source = chat();
    const prepared = prepareSubmitUsage(source, 'd');
    expect(prepared?.kind).toBe('estimated');
    if (prepared?.kind !== 'estimated') return;
    expect(prepared.promptMessages.map(item => item.content[0].type === 'text' ? item.content[0].text : ''))
      .toEqual(['instructions', 'Past conversation summary:\nA/B summary']);
    const result = call({ chat: source, targetNodeId: 'd', countTotalTokens: true,
      totalTokenUsed: { other: { promptTokens: 9, completionTokens: 1, imageTokens: 0 } } });
    expect(result.usageKey).toBe('model:::openrouter');
    expect(result.counterFields).toEqual(['promptTokens', 'completionTokens', 'imageTokens']);
    expect(result.changes.some((change: { path: string[] }) => change.path.includes('other'))).toBe(false);
    expect(call({ chat: source, targetNodeId: 'absent', countTotalTokens: true, totalTokenUsed: {} }))
      .toEqual({ changes: [] });
    expect(call({ chat: source, targetNodeId: 'd', countTotalTokens: false, totalTokenUsed: {} }))
      .toEqual({ changes: [] });
  });

  it('does not substitute a summary containing another generating node', () => {
    const prepared = prepareSubmitUsage(chat(), 'd', ['a', 'd']);
    expect(prepared?.kind).toBe('estimated');
    if (prepared?.kind !== 'estimated') return;
    expect(prepared.promptMessages.map(item => item.content[0].type === 'text' ? item.content[0].text : ''))
      .toEqual(['instructions', 'A', 'B']);
  });

  it('saves observation leaves on the node without touching unrelated chat data', () => {
    const source = chat();
    source.branchTree!.nodes.d.openRouterObservation = { generationId: 'old', cost: 2 };
    const result = JSON.parse(generationObservation(JSON.stringify({ chat: source, targetNodeId: 'd',
      observation: { promptTokens: 0, unknown: 'new' } })));
    expect(result.changes).toContainEqual({ op: 'set', path: ['branchTree', 'nodes', 'd', 'openRouterObservation', 'promptTokens'], value: 0 });
    expect(result.changes.some((change: { path: string[] }) => change.path.includes('cost') || change.path.includes('title'))).toBe(false);
  });
  it('adds live display counts through shared context without counting reasoning-first output', () => {
    const config = { model: 'fake', providerId: 'openai' };
    const input = { config, messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      completionParts: [{ type: 'text', text: 'Live' }] };
    expect(JSON.parse(generationLiveUsage(JSON.stringify(input)))).toEqual({ 'fake:::openai': { promptTokens: 7, completionTokens: 9, imageTokens: 0 } });
    expect(JSON.parse(generationLiveUsage(JSON.stringify({ ...input, completionParts: [{ type: 'reasoning', text: 'Reason' }, ...input.completionParts] })))['fake:::openai'].completionTokens).toBe(0);
  });
});
