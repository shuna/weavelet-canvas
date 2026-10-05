import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatInterface, BubbleSummary } from '@type/chat';
import { createChatSlice } from './chat-slice';
import { getSubmitContextMessages } from '@hooks/submitHelpers';
import { prepareChatForExport } from '@utils/chatExport';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useBubbleSummary, useSummaryDisplay } from '@components/Chat/ChatContent/Message/View/bubbleSummaryDisplay';

const state = vi.hoisted(() => ({ value: {} as any }));
vi.mock('@store/store', () => ({ default: Object.assign((selector: any) => selector(state.value), { getState: () => state.value }) }));
const source = (id: string, parentId: string | null, text: string) => ({ nodeId: id, parentId, role: 'user' as const, textParts: [text] });
const summary = (id: string, sources: BubbleSummary['sources'], useForSubmit = false): BubbleSummary => ({ id, sources, mode: 'range', text: `${id} summary`, useForSubmit });
const makeChat = (): ChatInterface => ({
  id: 'chat', title: 'Chat', titleSet: true, imageDetail: 'auto',
  config: { model: 'gpt-4o', max_tokens: 1000, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  messages: ['A', 'B', 'C'].map(text => ({ role: 'user', content: [{ type: 'text', text }] })),
  branchTree: { rootId: 'a', activePath: ['a', 'b', 'c'], nodes: Object.fromEntries(['a', 'b', 'c'].map((id, index) => [id, { id, parentId: index ? ['a', 'b'][index - 1] : null, role: 'user', contentHash: id, createdAt: index }])) },
  summaries: [summary('ab', [source('a', null, 'A'), source('b', 'a', 'B')], true)],
});
beforeEach(() => {
  state.value = { currentChatIndex: 0, chats: [makeChat()], omittedNodeMaps: {}, generatingSessions: {} };
  const set = (value: any) => Object.assign(state.value, typeof value === 'function' ? value(state.value) : value);
  Object.assign(state.value, createChatSlice(set, () => state.value));
  state.value.currentChatIndex = 0;
  useSummaryDisplay.setState({ chosen: {} });
});

describe('summary persistence and send selection', () => {
  it('preserves an overlapping saved summary and clears overlap for either send choice', () => {
    state.value.saveBubbleSummary('chat', summary('b', [source('b', 'a', 'B')]));
    expect(state.value.chats[0].summaries).toHaveLength(2);
    state.value.setSummaryForSubmit('chat', 'b', true);
    expect(state.value.chats[0].summaries.map((item: BubbleSummary) => item.useForSubmit)).toEqual([false, true]);
    state.value.setSummaryForSubmit('chat', 'ab', true);
    state.value.setSummaryForSubmit('chat', 'b', false);
    expect(state.value.chats[0].summaries.map((item: BubbleSummary) => item.useForSubmit)).toEqual([false, false]);
  });
  it('uses runtime omission for source invalidation and restores original exclusion', () => {
    state.value.omittedNodeMaps = { '0': { a: true } };
    const messages = getSubmitContextMessages(state.value.chats[0].messages, 'append', 3, 'gpt-4o', 0);
    expect(messages[0].content.map((part: any) => part.text)).toEqual(['B', 'C']);
  });
  it('preserves the configured system prompt in the shared send/count context', () => {
    const chat = state.value.chats[0];
    chat.config.systemPrompt = 'Keep the constraints';
    const messages = getSubmitContextMessages(chat.messages, 'append', 3, chat.config.model, 0, chat.config.systemPrompt);
    expect(messages[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'Keep the constraints' }] });
  });
  it('does not replace a summary when submission stops inside its sources', () => {
    const messages = getSubmitContextMessages(state.value.chats[0].messages, 'midchat', 1, 'gpt-4o', 0);
    expect(messages[0].content[0]).toEqual({ type: 'text', text: 'A' });
  });
  it('couples display choices to persisted send state and clears overlapping summaries', () => {
    const ab = state.value.chats[0].summaries[0];
    const b = summary('b', [source('b', 'a', 'B')]);
    state.value.saveBubbleSummary('chat', b);
    useSummaryDisplay.getState().choose('chat', ab);
    expect(state.value.chats[0].summaries.map((item: BubbleSummary) => item.useForSubmit)).toEqual([true, false]);
    useSummaryDisplay.getState().choose('chat', b);
    expect(state.value.chats[0].summaries.map((item: BubbleSummary) => item.useForSubmit)).toEqual([false, true]);
    expect(getSubmitContextMessages(state.value.chats[0].messages, 'append', 3, 'gpt-4o', 0).flatMap(message => message.content)).toContainEqual({ type: 'text', text: 'Past conversation summary:\nb summary' });
    useSummaryDisplay.getState().choose('chat', b, false);
    expect(state.value.chats[0].summaries.map((item: BubbleSummary) => item.useForSubmit)).toEqual([false, false]);
    expect(getSubmitContextMessages(state.value.chats[0].messages, 'append', 3, 'gpt-4o', 0).flatMap(message => message.content)).toContainEqual({ type: 'text', text: 'B' });
  });
  it('switches original, readable and compact within the same source range without changing source messages', () => {
    const ab = state.value.chats[0].summaries[0];
    const compact = { ...ab, id: 'compact', format: 'compact' as const, text: 'Compressed', useForSubmit: false };
    const other = { ...summary('c', [source('c', 'b', 'C')]), format: 'compact' as const };
    state.value.saveBubbleSummary('chat', compact); state.value.saveBubbleSummary('chat', other);
    const original = structuredClone(state.value.chats[0].messages);
    let display!: ReturnType<typeof useBubbleSummary>;
    const read = () => renderToStaticMarkup(createElement(() => { display = useBubbleSummary('b'); return null; }));
    read(); expect(display.tab).toBe('summary'); expect(display.compact?.id).toBe('compact');
    display.changeTab('compact'); read(); expect(display.tab).toBe('compact'); expect(display.summary?.id).toBe('compact');
    expect(state.value.chats[0].summaries.map((value: BubbleSummary) => value.useForSubmit)).toEqual([false, true, false]);
    state.value.saveBubbleSummary('chat', { ...display.summary!, text: 'Edited compact' });
    expect(getSubmitContextMessages(state.value.chats[0].messages, 'append', 3, 'gpt-4o', 0)[0].content).toContainEqual({ type: 'text', text: expect.stringContaining('Edited compact') });
    display.changeTab('summary'); read(); expect(display.tab).toBe('summary'); expect(display.summary?.text).toBe('ab summary');
    display.changeTab('original'); read(); expect(display.tab).toBe('original');
    expect(state.value.chats[0].summaries.every((value: BubbleSummary) => !value.useForSubmit)).toBe(true);
    expect(state.value.chats[0].messages).toEqual(original);
  });
  it('excludes hidden-branch source snapshots and target flags from visible-only export', () => {
    const chat = state.value.chats[0];
    chat.branchTree.nodes.hidden = { id: 'hidden', parentId: 'a', role: 'user', contentHash: 'hidden', createdAt: 1 };
    chat.summaryTargets = { a: true, hidden: true };
    chat.summaries.push(summary('hidden', [source('hidden', 'a', 'private')]));
    const content = Object.fromEntries(['a', 'b', 'c', 'hidden'].map(id => [id, { content: [{ type: 'text' as const, text: id }], refCount: 1 }]));
    const exported = prepareChatForExport(chat, content, { visibleBranchOnly: true }).chat;
    expect(exported.summaryTargets).toEqual({ a: true });
    expect(exported.summaries?.map(item => item.id)).toEqual(['ab']);
  });
});
