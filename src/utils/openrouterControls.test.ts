import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _defaultChatConfig, generateDefaultChat } from '@constants/chat';
import useStore from '@store/store';
import { getChatCompletion, getChatCompletionStream, prepareStreamRequest } from '@api/api';
import { savedModelSettings, switchConfigModel } from './modelSettings';
import { assertAuxiliaryEndpoint, observeOpenRouterHeaders, observeOpenRouterUsage, validateOpenRouterSettings } from './openrouterControls';
import type { ConfigInterface, MessageInterface } from '@type/chat';
import { generateTitleForChat } from '@hooks/submitHelpers';
import { runQualityEvaluation, runSafetyCheck } from '@api/evaluation';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const config: ConfigInterface = {
  ..._defaultChatConfig, model: 'anthropic/claude-sonnet-4', providerId: 'openrouter',
  openRouter: { routing: { only: ['anthropic'], allow_fallbacks: false, max_price: { prompt: 0 } }, stickySession: true, responseCache: { mode: 'on', ttlSeconds: 60 }, promptCache: { mode: 'claude-system', ttl: '1h' } },
};
const messages: MessageInterface[] = [{ role: 'system', content: [{ type: 'text', text: 'stable prefix' }] }, { role: 'user', content: [{ type: 'text', text: 'question' }] }];
beforeEach(() => vi.spyOn(useStore, 'getState').mockReturnValue({ providerCustomModels: {}, favoriteModels: [], providerModelCache: {} } as never));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('OpenRouter request controls', () => {
  it('maps nested settings, caches only a copy, and refreshes explicit regeneration', () => {
    const original = structuredClone(messages);
    const prepared = prepareStreamRequest(endpoint, messages, config, 'key', undefined, undefined, { chatId: 'chat-1', regenerate: true });
    expect(prepared.body).toMatchObject({ provider: { only: ['anthropic'], allow_fallbacks: false, max_price: { prompt: 0 } }, session_id: 'weavelet:chat-1' });
    expect(prepared.body).not.toHaveProperty('openRouter');
    expect((prepared.body as { messages: unknown[] }).messages[0]).toMatchObject({ content: [{ cache_control: { type: 'ephemeral', ttl: '1h' } }] });
    expect(prepared.headers).toMatchObject({ 'X-OpenRouter-Cache': 'true', 'X-OpenRouter-Cache-TTL': '60', 'X-OpenRouter-Cache-Clear': 'true' });
    expect(messages).toEqual(original);
  });
  it('does not leak any dedicated fields to a different API service', () => {
    const prepared = prepareStreamRequest('https://api.openai.com/v1/chat/completions', messages, { ...config, providerId: 'openai', systemPrompt: 'local', modelSource: 'remote' });
    expect(prepared.body).not.toHaveProperty('openRouter');
    expect(prepared.body).not.toHaveProperty('provider');
    expect(prepared.body).not.toHaveProperty('systemPrompt');
    expect(prepared.body).not.toHaveProperty('modelSource');
    expect(prepared.headers).not.toHaveProperty('X-OpenRouter-Cache');
  });
  it.each(['inherit', 'off', 'on'] as const)('preserves %s response-cache semantics', mode => {
    const bodyConfig = { ...config, openRouter: { responseCache: { mode } } };
    const initial = prepareStreamRequest(endpoint, messages, bodyConfig);
    expect(initial.headers['X-OpenRouter-Cache']).toBe(mode === 'inherit' ? undefined : String(mode === 'on'));
    const regenerated = prepareStreamRequest(endpoint, messages, bodyConfig, undefined, undefined, undefined, { regenerate: true });
    expect(regenerated.headers['X-OpenRouter-Cache']).toBe(mode === 'inherit' ? undefined : String(mode === 'on'));
    if (mode === 'inherit') expect(regenerated.headers).toEqual(initial.headers);
  });
  it('does not invent response-cache settings for regeneration of legacy chats', () => {
    const legacy = { ...config, openRouter: undefined };
    const normal = prepareStreamRequest(endpoint, messages, legacy);
    const regenerate = prepareStreamRequest(endpoint, messages, legacy, undefined, undefined, undefined, { regenerate: true });
    expect(regenerate).toEqual(normal);
    expect(regenerate.headers).not.toHaveProperty('X-OpenRouter-Cache');
  });
  it('adds growing-conversation cache control and never manufactures a missing system prefix', () => {
    expect(prepareStreamRequest(endpoint, messages, { ...config, openRouter: { promptCache: { mode: 'claude-conversation' } } }).body).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(() => prepareStreamRequest(endpoint, messages.slice(1), config)).toThrow();
  });
  it('uses the resolved endpoint even when providerId was absent', () => {
    const request = prepareStreamRequest(endpoint, messages, { ...config, providerId: undefined });
    expect(request.body).toHaveProperty('provider');
  });
  it('rejects lookalike endpoints for an OpenRouter configuration', () => {
    expect(() => prepareStreamRequest('https://openrouter.ai.example.com/chat/completions', messages, config)).toThrow();
  });
  it.each([0, -1, 1.5, 86401, NaN])('rejects invalid TTL %s', ttlSeconds => {
    expect(validateOpenRouterSettings({ responseCache: { mode: 'on', ttlSeconds } })).toBeDefined();
  });
  it('validates conflicts, model compatibility, price zero and ZDR combinations', () => {
    expect(validateOpenRouterSettings({ routing: { only: ['a'], ignore: ['a'] } })).toBeDefined();
    expect(validateOpenRouterSettings({ routing: { order: ['b'], only: ['a'] } })).toBeDefined();
    expect(validateOpenRouterSettings({ routing: { max_price: { prompt: 0 } } })).toBeUndefined();
    expect(validateOpenRouterSettings({ promptCache: { mode: 'claude-system' } }, 'openai/gpt-4.1')).toBeDefined();
    expect(validateOpenRouterSettings({ routing: { zdr: true }, responseCache: { mode: 'on' } })).toBeDefined();
    expect(prepareStreamRequest(endpoint, messages, { ...config, openRouter: { routing: { zdr: true }, responseCache: { mode: 'off' } } }).headers['X-OpenRouter-Cache']).toBe('false');
  });
  it('gives stream and non-stream calls the same controls and reports zero usage', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } }), { headers: { 'X-OpenRouter-Cache-Status': 'HIT' } }));
    vi.stubGlobal('fetch', fetcher);
    const observe = vi.fn();
    await getChatCompletion(endpoint, messages, config, 'key', undefined, undefined, undefined, { chatId: 'id', onObservation: observe });
    await getChatCompletionStream(endpoint, messages, config, 'key', undefined, undefined, undefined, { chatId: 'id', onObservation: observe });
    const requests = fetcher.mock.calls.map(call => call[1]);
    expect(requests[0].headers).toEqual(requests[1].headers);
    const first = JSON.parse(requests[0].body), second = JSON.parse(requests[1].body);
    expect(first.stream).toBe(false);
    expect(second.stream).toBe(true);
    delete first.stream;
    delete second.stream;
    expect(first).toEqual(second);
    expect(observe.mock.calls[0][0]).toMatchObject({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, cost: 0, responseCacheStatus: 'HIT' });
  });
});

describe('model-scoped OpenRouter settings', () => {
  it('restores independent nested settings and distinguishes a legacy missing field', () => {
    vi.spyOn(useStore, 'getState').mockReturnValue({ providerCustomModels: {}, favoriteModels: [], providerModelCache: {} } as never);
    const next = switchConfigModel(config, { model: 'openai/gpt-4.1', providerId: 'openrouter' });
    expect(next.openRouter).toEqual({ stickySession: true, responseCache: { mode: 'off' } });
    next.openRouter!.responseCache!.mode = 'on';
    const restored = switchConfigModel(next, { model: config.model, providerId: 'openrouter' });
    expect(restored.openRouter).toEqual(config.openRouter);
    expect(restored.openRouter).not.toBe(config.openRouter);
    restored.openRouter!.routing!.only!.push('other');
    expect(config.openRouter!.routing!.only).toEqual(['anthropic']);
    const other = switchConfigModel(config, { model: config.model, providerId: 'openai' });
    expect(other.openRouter).toBeUndefined();
    const legacy = { ...config, modelSettings: { [JSON.stringify(['remote', 'openrouter', 'legacy'])]: { ..._defaultChatConfig } } };
    expect(savedModelSettings(legacy, { model: 'legacy', providerId: 'openrouter' })).toHaveProperty('openRouter', undefined);
    expect(switchConfigModel(legacy, { model: 'legacy', providerId: 'openrouter' }).openRouter).toBeUndefined();
  });
  it('copies defaults and all snapshots without changing existing conversations', () => {
    const defaults = { ...config, modelSettings: { old: { ..._defaultChatConfig, openRouter: config.openRouter } } };
    vi.spyOn(useStore, 'getState').mockReturnValue({ providerCustomModels: {}, favoriteModels: [], providerModelCache: {}, defaultChatConfig: defaults, defaultSystemMessage: '', defaultImageDetail: 'auto' } as never);
    const first = generateDefaultChat(), second = generateDefaultChat();
    first.config.openRouter!.routing!.only!.push('new');
    first.config.modelSettings!.old.openRouter!.responseCache!.mode = 'off';
    expect(second.config.openRouter!.routing!.only).toEqual(['anthropic']);
    expect(defaults.openRouter!.responseCache!.mode).toBe('on');
    expect(second.config.modelSettings!.old.openRouter!.responseCache!.mode).toBe('on');
  });
});

describe('auxiliary constraints and observations', () => {
  it('allows unrestricted auxiliary APIs but blocks constrained ones before fetch', async () => {
    expect(() => assertAuxiliaryEndpoint(undefined, 'https://api.openai.com/v1/chat/completions')).not.toThrow();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(runQualityEvaluation('user', 'answer', 'https://api.openai.com/v1/chat/completions', 'gpt-4', 'key', 'en', undefined, config.openRouter)).rejects.toThrow();
    await expect(runSafetyCheck('user', config.openRouter)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('enforces title constraints without inheriting the Claude cache into another title model', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Title' } }] })));
    vi.stubGlobal('fetch', fetcher);
    await generateTitleForChat(messages, config, { titleModel: 'openai/gpt-4.1', titleProviderId: 'openrouter', favoriteModels: [], providers: { openrouter: { id: 'openrouter', name: 'OpenRouter', endpoint, modelsRequireAuth: true, apiKey: 'key' } }, fallbackProvider: { endpoint, key: 'key' }, t: key => key });
    const request = fetcher.mock.calls[0][1];
    expect(JSON.parse(request.body)).toMatchObject({ provider: { only: ['anthropic'], max_price: { prompt: 0 } } });
    expect(JSON.parse(request.body)).not.toHaveProperty('cache_control');
    expect(request.headers['X-OpenRouter-Cache']).toBe('false');
  });
  it('distinguishes absent usage from zero and ignores invalid numeric observations', () => {
    expect(observeOpenRouterUsage(undefined)).toEqual({});
    expect(observeOpenRouterUsage({ prompt_tokens: 0, completion_tokens: 0, cost: 0 })).toEqual({ promptTokens: 0, completionTokens: 0, cost: 0 });
    expect(observeOpenRouterUsage({ prompt_tokens: -1, completion_tokens: '5', cost: NaN })).toEqual({});
    expect(observeOpenRouterHeaders(new Headers())).toEqual({});
    expect(observeOpenRouterHeaders(new Headers({ 'X-OpenRouter-Cache-Status': 'HIT', 'X-OpenRouter-Cache-Age': '0' }))).toEqual({ responseCacheStatus: 'HIT', responseCacheAge: 0 });
  });
});
