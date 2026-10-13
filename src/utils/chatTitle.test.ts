import { describe, expect, it } from 'vitest';
import { _defaultChatConfig } from '@constants/chatDefaults';
import type { ChatInterface } from '@type/chat';
import { titleOperation } from '../../shared/google-sync/title';

const chat = { id: 'chat', title: 'New Chat', titleSet: false, config: _defaultChatConfig,
  imageDetail: 'auto', messages: [
    { role: 'user', content: [{ type: 'text', text: 'Explain branching' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Branches let you explore alternatives.' }] },
  ] } as ChatInterface;
const call = (input: object) => JSON.parse(titleOperation(JSON.stringify(input)));

describe('shared title operation', () => {
  it('selects the Web title model and provider and patches only title and usage', () => {
    const selection = call({ operation: 'select', chat, autoTitle: true, language: 'ja', settings: {
      titleModel: 'openai/gpt-4.1', titleProviderId: 'openrouter', favoriteModels: [], providers: {
        openrouter: { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', modelsRequireAuth: true },
      }, fallbackProvider: { endpoint: 'https://api.openai.com/v1/chat/completions' },
    } });
    expect(selection).toMatchObject({ status: 'ready', model: 'openai/gpt-4.1', providerId: 'openrouter',
      credentialProviderId: 'openrouter', config: { openRouter: { responseCache: { mode: 'off' } } } });
    expect(selection.promptMessage.content.at(-1).text).toContain('language: ja');
    const plan = call({ operation: 'plan', chat, selection, capabilities: { supportsReasoning: false, requiresReasoning: false },
      transport: { hasApiKey: true, viaProxy: true } });
    expect(plan.request.body).toMatchObject({ model: 'openai/gpt-4.1', stream: false,
      messages: [selection.promptMessage] });
    expect(plan.request.headers['X-OpenRouter-Cache']).toBe('false');
    expect(plan.request.authentication).toContainEqual({ name: 'Authorization', prefix: 'Bearer ' });
    const result = call({ operation: 'apply', chat, selection, responseText: '  "Branching Explained"  ',
      countTotalTokens: true, totalTokenUsed: { other: { promptTokens: 2, completionTokens: 3, imageTokens: 0 },
        'openai/gpt-4.1:::openrouter': { promptTokens: 5, completionTokens: 7, imageTokens: 0, opaque: 'keep' } } });
    expect(result.title).toBe('Branching Explained');
    expect(result.changes).toContainEqual({ op: 'set', path: ['chat', 'title'], value: 'Branching Explained' });
    expect(result.changes).toContainEqual({ op: 'set', path: ['chat', 'titleSet'], value: true });
    expect(result.changes.some((change: { path: string[] }) => change.path[0] === 'totalTokenUsed')).toBe(true);
    expect(result.changes.some((change: { path: string[] }) => change.path.includes('other') || change.path.includes('opaque'))).toBe(false);
    expect(result.usage.model).toBe('openai/gpt-4.1');
  });

  it('honors auto title eligibility and only edits title setting roots', () => {
    expect(call({ operation: 'select', chat, autoTitle: false, language: 'en', settings: {
      favoriteModels: [], providers: {}, fallbackProvider: { endpoint: 'x' },
    } })).toEqual({ status: 'skipped' });
    expect(call({ operation: 'settings', state: {} })).toEqual({ autoTitle: false, titleModel: '' });
    expect(call({ operation: 'saveSettings', state: { autoTitle: false, titleModel: '', titleProviderId: 'openai', untouched: 42 },
      value: { autoTitle: true, titleModel: 'gpt-4.1' } }).changes).toEqual(expect.arrayContaining([
      { op: 'set', path: ['autoTitle'], value: true },
      { op: 'set', path: ['titleModel'], value: 'gpt-4.1' },
      { op: 'remove', path: ['titleProviderId'] },
    ]));
  });
});
