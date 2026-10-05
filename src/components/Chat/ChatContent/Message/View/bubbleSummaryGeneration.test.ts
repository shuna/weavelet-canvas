import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatInterface } from '@type/chat';
import { startBubbleSummary, useSummaryGeneration } from './bubbleSummaryGeneration';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), save: vi.fn(), choose: vi.fn(), state: {} as any }));
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
  vi.clearAllMocks(); useSummaryGeneration.setState({ jobs: {} });
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

it('keeps the readable version and saves compact output without automatically sending it', async () => {
  const value = mocks.state.chats[0];
  value.summaries = [{ id: 'readable', mode: 'single', sources: [{ nodeId: 'a', parentId: null, role: 'user', textParts: ['Original'] }], text: 'Readable', useForSubmit: false }];
  mocks.generate.mockResolvedValue('Compact');
  expect(await startBubbleSummary(value, [0], 'single', 'a', { ...deps, summaryFormat: 'compact' })).toBe(true);
  const saved = mocks.save.mock.calls[0][1];
  expect(saved).toMatchObject({ format: 'compact', text: 'Compact', useForSubmit: false });
  expect(saved.id).not.toBe('readable');
  expect(mocks.choose).toHaveBeenCalledWith('chat', saved, false);
});
