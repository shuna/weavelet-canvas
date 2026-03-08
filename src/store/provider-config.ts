import { ProviderConfig, ProviderId } from '@type/provider';

export const DEFAULT_PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    modelsEndpoint: 'https://openrouter.ai/api/v1/models',
    modelsRequireAuth: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    modelsEndpoint: 'https://api.openai.com/v1/models',
    modelsRequireAuth: true,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    modelsEndpoint: 'https://api.mistral.ai/v1/models',
    modelsRequireAuth: true,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    modelsRequireAuth: true,
  },
  together: {
    id: 'together',
    name: 'Together AI',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    modelsEndpoint: 'https://api.together.xyz/v1/models',
    modelsRequireAuth: true,
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    endpoint: 'https://api.cohere.ai/v2/chat',
    modelsEndpoint: 'https://api.cohere.ai/v2/models',
    modelsRequireAuth: true,
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    modelsEndpoint: undefined,
    modelsRequireAuth: false,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    modelsEndpoint: 'https://api.deepseek.com/models',
    modelsRequireAuth: true,
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    modelsEndpoint: 'https://api.x.ai/v1/models',
    modelsRequireAuth: true,
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks',
    endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
    modelsEndpoint: 'https://api.fireworks.ai/inference/v1/models',
    modelsRequireAuth: true,
  },
};

export const PROVIDER_ORDER: ProviderId[] = [
  'openrouter',
  'openai',
  'deepseek',
  'mistral',
  'groq',
  'together',
  'perplexity',
  'xai',
  'cohere',
  'fireworks',
];
