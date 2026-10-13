import { describe, expect, it } from 'vitest';
import { tokenizerOperation, tokenBudgetOperation } from '../../shared/google-sync/tokenizer';
import { generationContext, generationRequest } from '../../shared/google-sync/generation';
import { _defaultChatConfig } from '@constants/chatDefaults';

const messages = [{role: 'user', content: [{type: 'text', text: '日本語🙂 e\u0301'}]},
  {role: 'assistant', content: [{type: 'text', text: 'reply'}]}];
const call = (operation: string, extra: object = {}) => JSON.parse(tokenizerOperation(JSON.stringify({operation, messages, ...extra})));

describe('shared tokenizer boundaries', () => {
  it('keeps the existing nonzero and unavailable encoder fallback', () => {
    expect(call('ensureCount', {count: 0})).toBe(call('fallbackCount'));
    expect(call('ensureCount', {count: 17})).toBe(17);
    expect(call('ensureCount', {count: 0, messages: []})).toBe(0);
    const last = call('fallbackCount', {messages: [messages[1]]});
    expect(call('fallbackLimit', {limit: last})).toEqual([1]);
    expect(call('fallbackLimit', {limit: last - 1})).toEqual([]);
    expect(call('throttle')).toBe(300);
  });
  it('uses the shared model context and completion reservation at the boundary', () => {
    const input = {config: {..._defaultChatConfig, model: 'fixture', max_tokens: 100},
      modelState: {favoriteModels: [{modelId: 'fixture', contextLength: 1000}]}};
    expect(JSON.parse(tokenBudgetOperation(JSON.stringify({...input, promptTokens: 900})))).toMatchObject({contextLength: 1000, promptBudget: 900, fits: true});
    expect(JSON.parse(tokenBudgetOperation(JSON.stringify({...input, promptTokens: 901})))).toMatchObject({fits: false});
  });
  it('feeds limited context through the normal request builder without changing source messages', () => {
    const config = {..._defaultChatConfig, model: 'fixture'};
    const input = {messages, config, capabilities: {supportsReasoning: false, requiresReasoning: false}};
    const context = JSON.parse(generationContext(JSON.stringify(input)));
    const body = JSON.parse(generationRequest(JSON.stringify({...input, tokenMessages: [context.at(-1)]})));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('assistant');
    expect(messages).toHaveLength(2);
  });
});
