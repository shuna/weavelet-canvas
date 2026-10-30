import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@store/store', () => ({ default: { getState: () => ({ proxyEnabled: true, proxyEndpoint: 'https://proxy.test', proxyAuthToken: 'proxy-key' }) } }));
vi.mock('@utils/modelLookup', () => ({ getModelSupportsReasoning: () => false, getModelRequiresReasoning: () => false }));
import { getChatCompletion, getChatCompletionStream, prepareStreamRequest } from './api';
import { runQualityEvaluation } from './evaluation';
import { _defaultChatConfig } from '@constants/chat';
const config = { ..._defaultChatConfig, providerId: 'lan' as const, model: 'o1-private', force_reasoning: false };
const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'private' }] }];
const endpoint = 'http://server/openai.com/custom?route=1';
afterEach(() => vi.unstubAllGlobals());
it('sends normal and streaming LAN generation directly with restrictive fetch options', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response('{"choices":[]}')); vi.stubGlobal('fetch', fetcher);
  await getChatCompletion(endpoint, messages, config);
  await getChatCompletionStream(endpoint, messages, config);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetcher.mock.calls) {
    expect(url).toBe(endpoint);
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(options.body)).not.toHaveProperty('reasoning_effort');
  }
});
it('keeps the quality URL unchanged and does not infer JSON mode from its name', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"choices":[]}')); vi.stubGlobal('fetch', fetcher);
  await expect(runQualityEvaluation('private', undefined, endpoint, config.model, undefined, 'en', undefined, undefined, undefined, 'lan')).rejects.toThrow('EMPTY_RESPONSE');
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(endpoint);
  expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' });
  expect(JSON.parse(options.body)).not.toHaveProperty('response_format');
});
it('rejects invalid or unconfigured LAN generation before fetching', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const url of ['', 'http://user:secret@server/chat', 'http://server/chat#x']) {
    await expect(getChatCompletion(url, messages, config)).rejects.toThrow();
    expect(() => prepareStreamRequest(url, messages, config)).toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});
