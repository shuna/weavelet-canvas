import { ProviderConfig, ProviderId, ProviderModel } from '@type/provider';

type UnknownRecord = Record<string, unknown>;
type ProviderPricingPayload = {
  prompt?: unknown;
  completion?: unknown;
};

type ProviderModelPayload = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  context_window?: unknown;
  created?: unknown;
  pricing?: unknown;
};

type ProviderModelListPayload = {
  data?: unknown;
  models?: unknown;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const asProviderModelListPayload = (value: unknown): ProviderModelListPayload =>
  (isRecord(value) ? value : {}) as ProviderModelListPayload;

const asProviderModelPayload = (value: unknown): ProviderModelPayload =>
  (isRecord(value) ? value : {}) as ProviderModelPayload;

const asProviderPricingPayload = (value: unknown): ProviderPricingPayload =>
  (isRecord(value) ? value : {}) as ProviderPricingPayload;

const toStringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const toNumberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const toMillionTokenPrice = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 1_000_000;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
  }
  return undefined;
};

const getModelEntries = (value: unknown): unknown[] => {
  const payload = asProviderModelListPayload(value);
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  return [];
};

const isSupportedModelId = (modelId: string) => {
  const normalizedId = modelId.toLowerCase();
  return !(
    normalizedId.includes('embed') ||
    normalizedId.includes('tts') ||
    normalizedId.includes('whisper') ||
    normalizedId.includes('dall-e') ||
    normalizedId.includes('moderation')
  );
};

const normalizeModelEntry = (
  providerId: ProviderId,
  entry: unknown
): ProviderModel | null => {
  const payload = asProviderModelPayload(entry);
  const id = toStringValue(payload.id) ?? toStringValue(payload.name);
  const name = toStringValue(payload.name) ?? toStringValue(payload.id);

  if (!id || !name || !isSupportedModelId(id)) {
    return null;
  }

  const pricing = asProviderPricingPayload(payload.pricing);
  const promptPrice = toMillionTokenPrice(pricing.prompt);
  const completionPrice = toMillionTokenPrice(pricing.completion);

  return {
    id,
    name,
    providerId,
    contextLength:
      toNumberValue(payload.context_length) ??
      toNumberValue(payload.context_window),
    promptPrice,
    completionPrice,
    created: toNumberValue(payload.created),
  };
};

const HARDCODED_MODELS: Record<ProviderId, ProviderModel[]> = {
  openrouter: [
    { id: 'openai/gpt-4o', name: 'GPT-4o', providerId: 'openrouter', contextLength: 128000 },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openrouter', contextLength: 128000 },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', providerId: 'openrouter', contextLength: 200000 },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', providerId: 'openrouter', contextLength: 1048576 },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', contextLength: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', contextLength: 128000 },
    { id: 'gpt-4.1', name: 'GPT-4.1', providerId: 'openai', contextLength: 1047576 },
    { id: 'o3-mini', name: 'o3-mini', providerId: 'openai', contextLength: 200000 },
  ],
  mistral: [
    { id: 'mistral-large-latest', name: 'Mistral Large', providerId: 'mistral', contextLength: 128000 },
    { id: 'mistral-small-latest', name: 'Mistral Small', providerId: 'mistral', contextLength: 32000 },
    { id: 'codestral-latest', name: 'Codestral', providerId: 'mistral', contextLength: 32000 },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', providerId: 'groq', contextLength: 128000 },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', providerId: 'groq', contextLength: 32768 },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9B', providerId: 'groq', contextLength: 8192 },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', providerId: 'together', contextLength: 128000 },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B', providerId: 'together', contextLength: 32768 },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo', providerId: 'together', contextLength: 32768 },
  ],
  cohere: [
    { id: 'command-r-plus', name: 'Command R+', providerId: 'cohere', contextLength: 128000 },
    { id: 'command-r', name: 'Command R', providerId: 'cohere', contextLength: 128000 },
  ],
  perplexity: [
    { id: 'sonar-pro', name: 'Sonar Pro', providerId: 'perplexity', contextLength: 200000 },
    { id: 'sonar', name: 'Sonar', providerId: 'perplexity', contextLength: 128000 },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3', providerId: 'deepseek', contextLength: 64000 },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', providerId: 'deepseek', contextLength: 64000 },
  ],
  xai: [
    { id: 'grok-2', name: 'Grok 2', providerId: 'xai', contextLength: 131072 },
    { id: 'grok-2-mini', name: 'Grok 2 Mini', providerId: 'xai', contextLength: 131072 },
  ],
  fireworks: [
    { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', providerId: 'fireworks', contextLength: 128000 },
    { id: 'accounts/fireworks/models/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', providerId: 'fireworks', contextLength: 32768 },
  ],
};

function normalizeModels(
  providerId: ProviderId,
  data: unknown
): ProviderModel[] {
  return getModelEntries(data)
    .map((entry) => normalizeModelEntry(providerId, entry))
    .filter((model): model is ProviderModel => model !== null);
}

function markHardcoded(models: ProviderModel[]): ProviderModel[] {
  return models.map((m) => ({ ...m, isHardcoded: true }));
}

export async function fetchProviderModels(
  provider: ProviderConfig
): Promise<ProviderModel[]> {
  if (!provider.modelsEndpoint) {
    return markHardcoded(HARDCODED_MODELS[provider.id] || []);
  }

  if (provider.modelsRequireAuth && !provider.apiKey) {
    return [];
  }

  try {
    const headers: HeadersInit = {};
    if (provider.modelsRequireAuth && provider.apiKey) {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const response = await fetch(provider.modelsEndpoint, { headers });
    if (!response.ok) {
      return [];
    }

    const json = await response.json();
    return normalizeModels(provider.id, json);
  } catch {
    return [];
  }
}

export function getHardcodedModels(providerId: ProviderId): ProviderModel[] {
  return HARDCODED_MODELS[providerId] || [];
}
