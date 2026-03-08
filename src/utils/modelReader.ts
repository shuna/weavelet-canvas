import { ModelCost } from '@type/chat';
import useStore from '@store/store';
import i18next from 'i18next';
import {
  curatedModels,
  detectModelType,
  normalizeStreamSupport,
  sortModelIds,
  type CatalogModel,
} from '@constants/modelCatalog';

interface ModelData {
  id: string;
  name: string;
  description: string;
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
  };
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type: string | null;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  per_request_limits: Record<string, unknown> | null;
  // TODO: Remove workaround once openrouter supports it;
  is_stream_supported: boolean; // custom field until better workaround or openrouter proper support
}

interface ModelsJson {
  data: ModelData[];
}

const modelsJsonUrl = 'models.json';

const assignModelEntry = (
  target: {
    modelOptions: string[];
    modelMaxToken: { [key: string]: number };
    modelCost: ModelCost;
    modelTypes: { [key: string]: string };
    modelStreamSupport: { [key: string]: boolean };
    modelDisplayNames: { [key: string]: string };
  },
  modelId: string,
  model: Pick<ModelData | CatalogModel, 'context_length' | 'pricing' | 'is_stream_supported'> & {
    type?: 'text' | 'image';
    name?: string;
    architecture?: { modality: string };
  },
  displayName: string
) => {
  target.modelOptions.push(modelId);
  target.modelMaxToken[modelId] = model.context_length;
  target.modelCost[modelId] = {
    prompt: { price: parseFloat(model.pricing.prompt), unit: 1 },
    completion: { price: parseFloat(model.pricing.completion), unit: 1 },
    image: {
      price:
        model.type === 'image' || parseFloat(model.pricing.image) > 0
          ? parseFloat(model.pricing.image)
          : 0,
      unit: 1,
    },
  };
  target.modelTypes[modelId] =
    model.type ?? detectModelType(model.architecture?.modality, model.pricing.image);
  target.modelStreamSupport[modelId] = model.is_stream_supported;
  target.modelDisplayNames[modelId] = displayName;
};

export const loadModels = async (): Promise<{
  modelOptions: string[];
  modelMaxToken: { [key: string]: number };
  modelCost: ModelCost;
  modelTypes: { [key: string]: string };
  modelStreamSupport: { [key: string]: boolean };
  modelDisplayNames: { [key: string]: string };
}> => {
  const response = await fetch(modelsJsonUrl);
  const modelsJson: ModelsJson = await response.json();

  const modelOptions: string[] = [];
  const modelMaxToken: { [key: string]: number } = {};
  const modelCost: ModelCost = {};
  const modelTypes: { [key: string]: string } = {};
  const modelStreamSupport: { [key: string]: boolean } = {};
  const modelDisplayNames: { [key: string]: string } = {};

  // Add custom models first
  const customModels = useStore.getState().customModels;
  customModels.forEach((model) => {
    const modelId = model.id;
    assignModelEntry(
      { modelOptions, modelMaxToken, modelCost, modelTypes, modelStreamSupport, modelDisplayNames },
      modelId,
      model,
      `${model.name} ${i18next.t('customModels.customLabel', { ns: 'model' })}`
    );
  });

  curatedModels.forEach((model) => {
    assignModelEntry(
      { modelOptions, modelMaxToken, modelCost, modelTypes, modelStreamSupport, modelDisplayNames },
      model.id,
      model,
      model.id
    );
  });

  modelsJson.data.forEach((model) => {
    const modelId = model.id.split('/').pop() as string;
    assignModelEntry(
      { modelOptions, modelMaxToken, modelCost, modelTypes, modelStreamSupport, modelDisplayNames },
      modelId,
      {
        ...model,
        is_stream_supported: normalizeStreamSupport(modelId),
      },
      modelId
    );
  });

  const sortedModelIds = sortModelIds(
    modelOptions,
    customModels.map((model) => model.id)
  );

  return {
    modelOptions: sortedModelIds,
    modelMaxToken,
    modelCost,
    modelTypes,
    modelStreamSupport,
    modelDisplayNames,
  };
};

export type ModelOptions = string;
