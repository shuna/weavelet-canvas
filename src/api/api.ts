import { getProxyConfig, fetchViaProxy } from '@utils/proxyClient';
import { applyOpenRouterControls, observeOpenRouterHeaders, observeOpenRouterUsage, type OpenRouterRequestContext } from '@utils/openrouterControls';
import {
  ConfigInterface,
  MessageInterface,
} from '@type/chat';
import { prepareRequestTransport, bindRequestAuthentication } from './requestTransport';
import { getModelSupportsReasoning, getModelRequiresReasoning } from '@utils/modelLookup';
import { buildReasoningCapabilities } from '@utils/modelReasoning';
import { buildRequestBody as buildSharedRequestBody } from './requestBody';

const buildRequestBody = (
  messages: MessageInterface[],
  config: ConfigInterface,
  overrides?: Record<string, unknown>
): Record<string, unknown> => {
  return buildSharedRequestBody(messages, config, buildReasoningCapabilities(config, getModelSupportsReasoning(config.model, config.providerId),
    () => getModelRequiresReasoning(config.model, config.providerId)), overrides);
};

export const getChatCompletion = async (
  endpoint: string,
  messages: MessageInterface[],
  config: ConfigInterface,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  apiVersionToUse?: string,
  signal?: AbortSignal,
  context?: OpenRouterRequestContext
) => {
  const transport = prepareRequestTransport(endpoint, config, !!apiKey, customHeaders, apiVersionToUse);
  endpoint = transport.endpoint;
  const headers = bindRequestAuthentication(transport, apiKey);

  const body = buildRequestBody(messages, config, { stream: false });
  const proxyConfig = getProxyConfig();
  applyOpenRouterControls(endpoint, config, body, headers as Record<string, string>, { ...context, viaProxy: !!proxyConfig });
  const response = await fetchViaProxy(proxyConfig, endpoint, headers as Record<string, string>, body, signal);
  if (!response.ok) throw new Error(await response.text());

  const data = await response.json();
  context?.onObservation?.({ ...observeOpenRouterHeaders(response.headers), ...observeOpenRouterUsage(data.usage) });
  return data;
};

export const getChatCompletionStream = async (
  endpoint: string,
  messages: MessageInterface[],
  config: ConfigInterface,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  apiVersionToUse?: string,
  signal?: AbortSignal,
  context?: OpenRouterRequestContext
) => {
  const transport = prepareRequestTransport(endpoint, config, !!apiKey, customHeaders, apiVersionToUse);
  endpoint = transport.endpoint;
  const headers = bindRequestAuthentication(transport, apiKey);
  const body = buildRequestBody(messages, config, { stream: true });
  const proxyConfig = getProxyConfig();
  applyOpenRouterControls(endpoint, config, body, headers as Record<string, string>, { ...context, viaProxy: !!proxyConfig });
  const response = await fetchViaProxy(proxyConfig, endpoint, headers as Record<string, string>, body, signal);
  if (response.status === 404 || response.status === 405) {
    const text = await response.text();

    if (text.includes('model_not_found')) {
      throw new Error(
        text +
          '\nMessage from Weavelet Canvas:\nPlease ensure that your account can access the requested OpenAI-compatible model.'
      );
    } else {
      throw new Error(
        'Message from Weavelet Canvas:\nInvalid API endpoint. Please verify your configured OpenAI-compatible endpoint.'
      );
    }
  }

  if (response.status === 429 || !response.ok) {
    const text = await response.text();
    let error = text;
    if (text.includes('insufficient_quota')) {
      error +=
        '\nMessage from Weavelet Canvas:\nWe recommend changing your API endpoint or API key.';
    } else if (response.status === 429) {
      error += '\nRate limited!';
    }
    throw new Error(error);
  }

  context?.onObservation?.(observeOpenRouterHeaders(response.headers));
  const stream = response.body;
  return stream;
};

export const prepareStreamRequest = (
  endpoint: string,
  messages: MessageInterface[],
  config: ConfigInterface,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  apiVersionToUse?: string,
  context?: OpenRouterRequestContext
): { endpoint: string; headers: Record<string, string>; body: object } => {
  const transport = prepareRequestTransport(endpoint, config, !!apiKey, customHeaders, apiVersionToUse);
  endpoint = transport.endpoint;
  const headers = bindRequestAuthentication(transport, apiKey);

  const body = buildRequestBody(messages, config, { stream: true });

  applyOpenRouterControls(endpoint, config, body, headers, context);
  return { endpoint, headers, body };
};
