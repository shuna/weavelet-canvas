type ModelPricing = {
  prompt: string;
  completion: string;
  image: string;
  request: string;
};

type ModelArchitecture = {
  modality: string;
  tokenizer: string;
  instruct_type: string | null;
};

type ModelTopProvider = {
  context_length: number;
  max_completion_tokens: number | null;
  is_moderated: boolean;
};

export type CatalogModel = {
  id: string;
  name?: string;
  description?: string;
  pricing: ModelPricing;
  context_length: number;
  architecture?: ModelArchitecture;
  top_provider?: ModelTopProvider;
  per_request_limits?: Record<string, unknown> | null;
  is_stream_supported: boolean;
  type?: 'text' | 'image';
  created?: number;
};

const o3MiniDescription =
  'OpenAI o3-mini is a cost-efficient language model optimized for STEM reasoning tasks, particularly excelling in science, mathematics, and coding. The model features three adjustable reasoning effort levels and supports key developer capabilities including function calling, structured outputs, and streaming, though it does not include vision processing capabilities.\n\nThe model demonstrates significant improvements over its predecessor, with expert testers preferring its responses 56% of the time and noting a 39% reduction in major errors on complex questions. With medium reasoning effort settings, o3-mini matches the performance of the larger o1 model on challenging reasoning evaluations like AIME and GPQA, while maintaining lower latency and cost.';

const baseO3MiniModel = {
  architecture: {
    instruct_type: null,
    modality: 'text->text',
    tokenizer: 'Other',
  },
  context_length: 200000,
  created: 1738351721,
  description: o3MiniDescription,
  per_request_limits: null,
  pricing: {
    completion: '0.0000044',
    image: '0',
    prompt: '0.0000011',
    request: '0',
  },
  top_provider: {
    context_length: 200000,
    is_moderated: true,
    max_completion_tokens: 100000,
  },
  is_stream_supported: false,
  type: 'text' as const,
};

export const curatedModels: CatalogModel[] = [
  {
    id: 'gpt-4-0125-preview',
    pricing: {
      prompt: '0.00001',
      completion: '0.00003',
      image: '0.01445',
      request: '0',
    },
    context_length: 128000,
    is_stream_supported: true,
    type: 'text',
  },
  {
    id: 'gpt-4-turbo-2024-04-09',
    pricing: {
      prompt: '0.00001',
      completion: '0.00003',
      image: '0.01445',
      request: '0',
    },
    context_length: 128000,
    is_stream_supported: false,
    type: 'text',
  },
  {
    ...baseO3MiniModel,
    id: 'o3-mini-low',
    name: 'OpenAI: o3 Mini (Low)',
  },
  {
    ...baseO3MiniModel,
    id: 'o3-mini-medium',
    name: 'OpenAI: o3 Mini (Medium)',
  },
  {
    ...baseO3MiniModel,
    id: 'o3-mini-high',
    name: 'OpenAI: o3 Mini (High)',
  },
];

export const normalizeStreamSupport = (modelId: string): boolean =>
  !modelId.includes('o1-');

export const detectModelType = (
  modality: string | undefined,
  imagePrice: string
): 'text' | 'image' => {
  const inputModality = modality?.split('->')[0] ?? '';
  return parseFloat(imagePrice) > 0 || inputModality.includes('image')
    ? 'image'
    : 'text';
};

export const sortModelIds = (
  modelIds: string[],
  customModelIds: string[]
): string[] =>
  modelIds.slice().sort((a, b) => {
    const isCustomA = customModelIds.includes(a);
    const isCustomB = customModelIds.includes(b);
    const isGpt45A = a.includes('gpt-4.');
    const isGpt45B = b.includes('gpt-4.');
    const isGpt4oA = a.startsWith('gpt-4o');
    const isGpt4oB = b.startsWith('gpt-4o');
    const isO3A = a.startsWith('o3-');
    const isO3B = b.startsWith('o3-');
    const isO1A = a.startsWith('o1-');
    const isO1B = b.startsWith('o1-');
    const isOpenAIA = a.startsWith('gpt-');
    const isOpenAIB = b.startsWith('gpt-');

    if (isGpt45A && !isGpt45B) return -1;
    if (!isGpt45A && isGpt45B) return 1;
    if (isCustomA && !isCustomB) return -1;
    if (!isCustomA && isCustomB) return 1;
    if (isGpt4oA && !isGpt4oB) return -1;
    if (!isGpt4oA && isGpt4oB) return 1;
    if (isO3A && !isO3B) return -1;
    if (!isO3A && isO3B) return 1;
    if (isO1A && !isO1B) return -1;
    if (!isO1A && isO1B) return 1;
    if (isOpenAIA && !isOpenAIB) return -1;
    if (!isOpenAIA && isOpenAIB) return 1;
    return 0;
  });
