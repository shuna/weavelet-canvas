import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatInterface } from '@type/chat';
import { startBubbleSummary, useSummaryGeneration } from './bubbleSummaryGeneration';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), save: vi.fn(), choose: vi.fn(), count: vi.fn(), state: {} as any }));
vi.mock('@utils/messageUtils', () => ({ default: mocks.count }));
vi.mock('@hooks/submitHelpers', () => ({ generateBubbleSummary: mocks.generate }));
vi.mock('@store/store', () => ({ default: { getState: () => mocks.state } }));
vi.mock('./bubbleSummaryDisplay', () => ({ useSummaryDisplay: { getState: () => ({ choose: mocks.choose }) } }));
const chat = (): ChatInterface => ({ id: 'chat', title: 'Chat', titleSet: true, imageDetail: 'auto',
  config: { model: 'gpt-4o', max_tokens: 1000, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Original' }] }],
  branchTree: { rootId: 'a', activePath: ['a'], nodes: { a: { id: 'a', parentId: null, role: 'user', contentHash: 'a', createdAt: 0 } } },
});
const deps = { favoriteModels: [], providers: {}, fallbackProvider: { endpoint: 'https://example.test', key: 'test' }, t: (key: string) => key };
beforeEach(() => {
  vi.clearAllMocks(); mocks.count.mockReset().mockResolvedValueOnce(100).mockResolvedValue(20); useSummaryGeneration.setState({ jobs: {} });
  mocks.state = { chats: [chat()], omittedNodeMaps: {}, generatingSessions: {}, saveBubbleSummary: mocks.save };
});
it('keeps the pending request outside the UI and prevents overlapping duplicate requests', async () => {
  let finish!: (text: string) => void;
  mocks.generate.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', deps);
  expect(useSummaryGeneration.getState().jobs['chat:a'].busy).toBe(true);
  expect(await startBubbleSummary(mocks.state.chats[0], [0], 'single', 'other', deps)).toBe(false);
  expect(mocks.generate).toHaveBeenCalledOnce();
  mocks.state.currentChatIndex = 1;
  finish('Summary');
  expect(await pending).toBe(true);
  expect(mocks.save).toHaveBeenCalledWith('chat', expect.objectContaining({ text: 'Summary', generation: expect.objectContaining({ model: 'gpt-4o', settings: expect.objectContaining({ max_tokens: 1000, temperature: 1 }) }) }));
  expect(mocks.choose).toHaveBeenCalledOnce();
  expect(useSummaryGeneration.getState().jobs).toEqual({});
});
it('retains a background failure for reopening and clears it on successful retry', async () => {
  mocks.generate.mockRejectedValueOnce(new Error('API failed')).mockResolvedValueOnce('Summary');
  expect(await startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', deps)).toBe(false);
  expect(useSummaryGeneration.getState().jobs['chat:a']).toMatchObject({ busy: false, error: 'API failed' });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(await startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', deps)).toBe(true);
  expect(useSummaryGeneration.getState().jobs).toEqual({});
});
it('does not save a result when its source changed while the request was pending', async () => {
  let finish!: (text: string) => void;
  mocks.generate.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', deps);
  mocks.state.chats = [{ ...chat(), messages: [{ role: 'user', content: [{ type: 'text', text: 'Changed' }] }] }];
  finish('Summary');
  expect(await pending).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(useSummaryGeneration.getState().jobs['chat:a'].error).toContain('原文や状態が変わりました');
});

it('keeps the readable version and selects compact output after generation', async () => {
  const value = mocks.state.chats[0];
  value.summaries = [{ id: 'readable', mode: 'single', sources: [{ nodeId: 'a', parentId: null, role: 'user', textParts: ['Original'] }], text: 'Readable', useForSubmit: false }];
  mocks.generate.mockResolvedValue('Compact');
  expect(await startBubbleSummary(value, [0], 'single', 'a', { ...deps, summaryFormat: 'compact' })).toBe(true);
  const saved = mocks.save.mock.calls[0][1];
  expect(saved).toMatchObject({ format: 'compact', text: 'Compact', useForSubmit: false });
  expect(saved.id).not.toBe('readable');
  expect(mocks.choose).toHaveBeenCalledWith('chat', saved, true);
});

it.each([100, 120])('saves output but retains original when replacement costs %s tokens versus 100', async replacement => {
 mocks.count.mockReset().mockResolvedValueOnce(100).mockResolvedValueOnce(replacement);
 mocks.generate.mockResolvedValue('Expanded compact context');
 expect(await startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', { ...deps, summaryFormat: 'compact' })).toBe(true);
 const saved = mocks.save.mock.calls[0][1];
 expect(saved.text).toBe('Expanded compact context');
 expect(mocks.choose).toHaveBeenCalledWith('chat', saved, false);
 expect(useSummaryGeneration.getState().jobs['chat:a']).toMatchObject({ busy: false, error: '', warning: expect.stringContaining('原文を表示・送信') });
});
it('does not apply a result when the source changes during token comparison', async () => {
 let finish!: (count: number) => void;
 mocks.count.mockReset().mockResolvedValueOnce(100).mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
 mocks.generate.mockResolvedValue('Compact');
 const pending = startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', { ...deps, summaryFormat: 'compact' });
 await vi.waitFor(() => expect(finish).toBeDefined());
 mocks.state.chats[0].messages[0].content[0].text = 'Changed';
 finish(20);
 expect(await pending).toBe(false);
 expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.choose).not.toHaveBeenCalled();
});

it.each([undefined, 'compact'] as const)('saves and selects format %s of an omitted bubble', async format => {
  mocks.state.omittedNodeMaps = { '0': { a: true } };
  mocks.generate.mockResolvedValue('Summary');
  expect(await startBubbleSummary(mocks.state.chats[0], [0], 'single', 'a', { ...deps, summaryFormat: format })).toBe(true);
  expect(mocks.save).toHaveBeenCalledWith('chat', expect.objectContaining({ text: 'Summary' }));
  expect(mocks.choose).toHaveBeenCalledOnce();
});
