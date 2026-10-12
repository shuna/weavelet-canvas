import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ state: {} as any, captured: {} as any }));
vi.mock('@store/store', () => ({ default: { getState: () => runtime.state } }));
vi.mock('@utils/proxyClient', () => ({
  getProxyConfig: () => undefined,
  fetchViaProxy: async (_proxy: unknown, endpoint: string, headers: object, body: object) => {
    runtime.captured = { endpoint, headers, body };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'FAKE' } }] }));
  },
}));
import { getSubmitContextMessages } from '@hooks/submitHelpers';
import { generationRequest } from '../../shared/google-sync/generation';
import { getChatCompletion, prepareStreamRequest } from '@api/api';
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/remote-generation.json', import.meta.url), 'utf8'));
describe('OpenAI-compatible native remote request contract', () => {
  for (const test of fixture.cases) it(test.name, async () => {
    const chat = test.source.chats[0];
    runtime.state = { chats: [chat], omittedNodeMaps: {}, favoriteModels: [], providerModelCache: {}, providerCustomModels: {} };
    const config = { ...chat.config, model: test.settings.model, stream: test.settings.stream };
    const context = getSubmitContextMessages(chat.messages, 'append', chat.messages.length, config.model, 0, config.systemPrompt);
    const result = test.settings.stream
      ? prepareStreamRequest(test.settings.endpoint, context, config, test.key)
      : (await getChatCompletion(test.settings.endpoint, context, config, test.key), runtime.captured);
    expect(JSON.parse(JSON.stringify(result))).toEqual(test.expected);
    const bridgedBody = JSON.parse(generationRequest(JSON.stringify({
      messages: chat.messages, config, activePath: chat.branchTree?.activePath,
      omittedNodes: chat.omittedNodes,
      capabilities: { supportsReasoning: false, requiresReasoning: false },
    })));
    expect(bridgedBody).toEqual(test.expected.body);
    expect(result.body.messages.some((message: any) => 'xMessage' in message)).toBe(false);
    expect(test.source.apiKey).toBe('FAKE-imported-not-request-key');
  });
});
