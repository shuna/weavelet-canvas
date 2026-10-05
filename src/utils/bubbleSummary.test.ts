import { describe, expect, it } from 'vitest';
import type { ChatInterface, MessageInterface } from '@type/chat';
import { applyBubbleSummariesForSubmit, normalizeBubbleSummaryText, resolveValidSummary } from './bubbleSummary';

const message = (role: 'user' | 'assistant' | 'system', text: string): MessageInterface => ({ role, content: [{ type: 'text', text }] });
const chat = (): ChatInterface => ({
  id: 'chat', title: 'Chat', titleSet: true, imageDetail: 'auto', config: {} as ChatInterface['config'],
  messages: [message('user', 'A'), message('assistant', 'B'), message('user', 'C'), message('assistant', 'D')],
  branchTree: { rootId: 'a', activePath: ['a', 'b', 'c', 'd'], nodes: {
    a: { id: 'a', parentId: null, role: 'user', contentHash: '', createdAt: 0 }, b: { id: 'b', parentId: 'a', role: 'assistant', contentHash: '', createdAt: 0 }, c: { id: 'c', parentId: 'b', role: 'user', contentHash: '', createdAt: 0 }, d: { id: 'd', parentId: 'c', role: 'assistant', contentHash: '', createdAt: 0 },
  } },
  omittedNodes: { c: true },
  summaries: [{ id: 's', mode: 'range', useForSubmit: true, text: 'A と B の要約', sources: [
    { nodeId: 'a', parentId: null, role: 'user', textParts: ['A'] }, { nodeId: 'b', parentId: 'a', role: 'assistant', textParts: ['B'] },
  ] }],
});

describe('bubble summary submit replacement', () => {
  it('replaces A/B, omits C, and retains D using original path indexes', () => {
    const result = applyBubbleSummariesForSubmit(chat(), 4);
    expect(result.map(item => item.content[0].type === 'text' ? item.content[0].text : '')).toEqual(['Past conversation summary:\nA と B の要約', 'D']);
  });
  it('rejects changed source text and sends originals', () => {
    const value = chat(); value.messages[1] = message('assistant', 'changed');
    expect(resolveValidSummary(value, value.summaries![0])).toBeNull();
    expect(applyBubbleSummariesForSubmit(value, 4)).toHaveLength(3);
  });
  it('does not replace overlapping summaries', () => {
    const value = chat(); value.omittedNodes = {}; value.summaries!.push({ ...value.summaries![0], id: 'overlap', text: 'other', sources: [
      value.summaries![0].sources[1], { nodeId: 'c', parentId: 'b', role: 'user', textParts: ['C'] },
    ] });
    expect(applyBubbleSummariesForSubmit(value, 4).map(item => item.content[0].type === 'text' ? item.content[0].text : '')).toEqual(['A', 'B', 'C', 'D']);
  });
  it('rejects omitted, generating, non-text, or reordered sources', () => {
    const value = chat(), summary = value.summaries![0];
    expect(resolveValidSummary(value, summary, ['a'])).toBeNull();
    value.omittedNodes = { a: true };
    expect(resolveValidSummary(value, summary)).toBeNull();
    value.omittedNodes = {};
    value.messages[0].content.push({ type: 'reasoning', text: 'hidden' });
    expect(resolveValidSummary(value, summary)).toBeNull();
    value.messages[0] = message('user', 'A');
    summary.sources.reverse();
    expect(resolveValidSummary(value, summary)).toBeNull();
  });
  it('compares text parts without NUL joining ambiguity', () => {
    const value = chat();
    value.messages[0] = { role: 'user', content: [{ type: 'text', text: 'A\u0000B' }] };
    value.summaries![0].sources[0].textParts = ['A', 'B'];
    expect(resolveValidSummary(value, value.summaries![0])).toBeNull();
  });
});


it('never replaces image or tool content, and keeps omitted tool exchanges', () => {
  const value = chat();
  value.messages[0].content.push({ type: 'image_url', image_url: { url: 'image', detail: 'auto' } });
  expect(resolveValidSummary(value, value.summaries![0])).toBeNull();
  expect(applyBubbleSummariesForSubmit(value, 4)[0].content).toHaveLength(2);
  value.messages[2].content = [{ type: 'tool_result', tool_call_id: 'tool', content: 'result' }];
  expect(applyBubbleSummariesForSubmit(value, 4).some(message => message.content.some(part => part.type === 'tool_result'))).toBe(true);
});

describe('serialized summary output', () => {
  it('decodes message wrappers, arrays, fenced JSON and JSON strings', () => {
    const content = '# 要約\n\n条件を保持';
    expect(normalizeBubbleSummaryText(JSON.stringify({ role: 'user', content }))).toBe(content);
    expect(normalizeBubbleSummaryText('```json\n' + JSON.stringify({ role: 'user', content }) + '\n```')).toBe(content);
    expect(normalizeBubbleSummaryText(JSON.stringify(content))).toBe(content);
    expect(normalizeBubbleSummaryText(JSON.stringify([{ role: 'user', content }, { role: 'assistant', content: '提案' }]))).toBe(content + '\n\nアシスタント：\n提案');
    const value = chat(); value.summaries![0].text = JSON.stringify({ role: 'user', content });
    expect(applyBubbleSummariesForSubmit(value, 4)[0].content).toEqual([{ type: 'text', text: 'Past conversation summary:\n' + content }]);
  });
  it('preserves Markdown, literal escapes, unrelated JSON and incomplete output', () => {
    for (const text of ['# 要約\n\n本文', String.raw`コードの \n を保持`, '{"setting":true}', '{"role":"user","content":"unfinished']) {
      expect(normalizeBubbleSummaryText(text)).toBe(text);
    }
  });
});
