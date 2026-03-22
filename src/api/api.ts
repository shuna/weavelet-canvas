import {
  ConfigInterface,
  MessageInterface,
} from '@type/chat';
import { isAzureEndpoint } from '@utils/api';
import { getModelSupportsReasoning } from '@utils/modelLookup';

/**
 * Build the API-ready body from ConfigInterface.
 * Strips client-only fields (providerId, reasoning_budget_tokens when unused)
 * and conditionally includes reasoning parameters for supported models.
 */
const buildRequestBody = (
  messages: MessageInterface[],
  config: ConfigInterface,
  overrides?: Record<string, unknown>
): Record<string, unknown> => {
  const {
    providerId,
    reasoning_effort,
    reasoning_budget_tokens,
    ...apiConfig
  } = config;

  const body: Record<string, unknown> = {
    messages,
    ...apiConfig,
    max_tokens: config.max_tokens > 0 ? config.max_tokens : undefined,
    ...overrides,
  };

  // Only include reasoning params when the model actually supports reasoning
  if (getModelSupportsReasoning(config.model, providerId)) {
    if (reasoning_effort) {
      body.reasoning_effort = reasoning_effort;
    }
    if (reasoning_budget_tokens && reasoning_budget_tokens > 0) {
      body.reasoning_budget_tokens = reasoning_budget_tokens;
    }
  }

  return body;
};

export const getChatCompletion = async (
  endpoint: string,
  messages: MessageInterface[],
  config: ConfigInterface,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  apiVersionToUse?: string,
  signal?: AbortSignal
) => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (isAzureEndpoint(endpoint) && apiKey) {
    headers['api-key'] = apiKey;

    const apiVersion = apiVersionToUse ?? '2024-02-01';
    const path = `openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;

    if (!endpoint.endsWith(path)) {
      if (!endpoint.endsWith('/')) {
        endpoint += '/';
      }
      endpoint += path;
    }
  }
  endpoint = endpoint.trim();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildRequestBody(messages, config)),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());

  const data = await response.json();
  return data;
};

export const getChatCompletionStream = async (
  endpoint: string,
  messages: MessageInterface[],
  config: ConfigInterface,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  apiVersionToUse?: string,
  signal?: AbortSignal
) => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (isAzureEndpoint(endpoint) && apiKey) {
    headers['api-key'] = apiKey;

    const apiVersion = apiVersionToUse ?? '2024-02-01';
    const path = `openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;

    if (!endpoint.endsWith(path)) {
      if (!endpoint.endsWith('/')) {
        endpoint += '/';
      }
      endpoint += path;
    }
  }
  endpoint = endpoint.trim();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildRequestBody(messages, config, { stream: true })),
    signal,
  });
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

  const stream = response.body;
  return stream;
};

export const prepareStreamRequest = (
  endpoint: string,
  messages: MessageInterface[],
  config: ConfigInterface,
  apiKey?: string,
  customHeaders?: Record<string, string>,
  apiVersionToUse?: string
): { endpoint: string; headers: Record<string, string>; body: object } => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (isAzureEndpoint(endpoint) && apiKey) {
    headers['api-key'] = apiKey;

    const apiVersion = apiVersionToUse ?? '2024-02-01';
    const path = `openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;

    if (!endpoint.endsWith(path)) {
      if (!endpoint.endsWith('/')) {
        endpoint += '/';
      }
      endpoint += path;
    }
  }
  endpoint = endpoint.trim();

  const body = buildRequestBody(messages, config, { stream: true });

  return { endpoint, headers, body };
};

