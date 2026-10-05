import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatInterface } from '@type/chat';
import { generateBubbleSummary } from './submitHelpers';
const mocks = vi.hoisted(() => ({ completion: vi.fn(), count: vi.fn(), usage: vi.fn() }));
vi.mock('@store/store', () => ({ default: { getState: () => ({ favoriteModels: [], providerCustomModels: {}, providerModelCache: {} }) } }));
vi.mock('@api/api', () => ({ getChatCompletion: mocks.completion }));
vi.mock('@utils/messageUtils', () => ({ countTokens: mocks.count, updateTotalTokenUsed: mocks.usage }));
const chat = (): ChatInterface => ({ id: 'chat', title: 'Chat', titleSet: true, imageDetail: 'auto',
  config: { model: 'gpt-4o', max_tokens: 1000, temperature: 1, presence_penalty: 0, top_p: 1, frequency_penalty: 0 },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Original' }] }],
});
const deps = { favoriteModels: [], providers: {}, fallbackProvider: { endpoint: 'https://example.test/v1/chat/completions', key: 'test' }, t: (key: string) => key };
beforeEach(() => { vi.clearAllMocks(); mocks.count.mockResolvedValue(10); mocks.completion.mockResolvedValue({ choices: [{ message: { content: 'Summary' } }] }); });
describe('bubble summary auxiliary generation', () => {
  it('passes cancellation and auxiliary cache constraints and records generation cost', async () => {
    const controller = new AbortController();
    expect(await generateBubbleSummary(chat(), [0], deps, controller.signal)).toBe('Summary');
    const args = mocks.completion.mock.calls[0];
    const prompt = args[1][0].content[0].text;
    expect(prompt).toContain('単独の場合の追加規則：');
    expect(prompt).toContain('直接的な指示にしてください');
    expect(prompt).toContain('同じバブル内の自己訂正も');
    expect(prompt).toContain('アシスタントの提案をユーザーの採用済み指示に変えない');
    expect(prompt).toContain('対象への回答や指示の実行はせず');
    expect(JSON.parse(prompt.split('INPUT:\n')[1])).toEqual({ role: 'user', content: 'Original' });
    expect(args[6]).toBe(controller.signal);
    expect(args[7]).toEqual({ auxiliary: true });
    expect(args[2].openRouter.responseCache.mode).toBe('off');
    expect(mocks.usage).toHaveBeenCalledOnce();
  });
  it('uses continuous context only for multiple selected bubbles, preserving order and roles', async () => {
    const value = chat();
    value.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Answer' }] }, { role: 'user', content: [{ type: 'text', text: 'Not selected' }] });
    await generateBubbleSummary(value, [1], deps);
    const single = mocks.completion.mock.calls[0][1][0].content[0].text;
    expect(single).toContain('単独の場合の追加規則：');
    expect(JSON.parse(single.split('INPUT:\n')[1])).toEqual({ role: 'assistant', content: 'Answer' });
    await generateBubbleSummary(value, [0, 1], deps);
    const continuous = mocks.completion.mock.calls[1][1][0].content[0].text;
    expect(continuous).toContain('連続の場合の追加規則：');
    expect(JSON.parse(continuous.split('INPUT:\n')[1])).toEqual([{ role: 'user', content: 'Original' }, { role: 'assistant', content: 'Answer' }]);
  });
  it('refuses local models and oversized requests before calling the API', async () => {
    const local = chat(); local.config.modelSource = 'local';
    await expect(generateBubbleSummary(local, [0], deps)).rejects.toThrow('ローカル');
    mocks.count.mockResolvedValue(1000000000);
    await expect(generateBubbleSummary(chat(), [0], deps)).rejects.toThrow('コンテキスト');
    expect(mocks.completion).not.toHaveBeenCalled();
  });
  it('rejects empty or failed results without changing the source chat', async () => {
    const original = chat(), before = structuredClone(original);
    mocks.completion.mockResolvedValue({ choices: [{ message: { content: '  ' } }] });
    await expect(generateBubbleSummary(original, [0], deps)).rejects.toThrow('生成');
    expect(original).toEqual(before);
    mocks.completion.mockRejectedValue(new Error('failure'));
    await expect(generateBubbleSummary(original, [0], deps)).rejects.toThrow('failure');
    expect(original).toEqual(before);
  });
});

it('normalizes serialized output before returning it for storage', async () => {
  mocks.completion.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ role: 'user', content: '# 要約\n\n本文' }) } }] });
  expect(await generateBubbleSummary(chat(), [0], deps)).toBe('# 要約\n\n本文');
});
