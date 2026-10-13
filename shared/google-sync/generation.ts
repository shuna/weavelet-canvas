import { prepareRequestTransport } from '../../src/api/requestTransport';
import { isOpenRouterURL, applyOpenRouterControls } from '../../src/utils/openrouterRequest';
import { normalizeRemoteConfig } from './chatConfig';
import { getRequestReasoningCapabilities, type ReasoningModelState } from '../../src/utils/modelReasoning';
import { materializeActivePath } from '../../src/utils/branchUtils';
import type { ContentStoreData } from '../../src/utils/contentStore';
import { buildRequestBody } from '../../src/api/requestBody';
import { getSubmitContextMessages } from '../../src/utils/submitContext';
import type { ChatInterface, ConfigInterface, MessageInterface } from '../../src/types/chat';

export type GenerationContextInput = {
  messages?: MessageInterface[]; contentStore?: ContentStoreData; chat?: ChatInterface;
  generatingNodeIds?: string[]; config: ConfigInterface; activePath?: string[];
  omittedNodes?: Record<string, boolean>; messageIndex?: number;
};
export function getGenerationMessages(input: GenerationContextInput): MessageInterface[] {
  const path = input.activePath ?? input.chat?.branchTree?.activePath;
  let chat = input.chat;
  if (chat?.branchTree && input.contentStore) {
    const branchTree = { ...chat.branchTree, activePath: path! };
    chat = { ...chat, branchTree, messages: materializeActivePath(branchTree, input.contentStore) };
  }
  const projected = chat?.messages ?? input.messages ?? [];
  return getSubmitContextMessages(projected, input.messageIndex ?? projected.length,
    input.config.model, path, input.omittedNodes ?? chat?.omittedNodes, input.config.systemPrompt,
    chat ? { chat, generatingNodeIds: input.generatingNodeIds ?? [] } : undefined);
}
export const generationContext = (json: string): string => JSON.stringify(getGenerationMessages(JSON.parse(json)));

export const generationRequest = (json: string): string => {
  const input: {
    messages?: MessageInterface[];
    tokenMessages?: MessageInterface[];
    contentStore?: ContentStoreData;
    chat?: ChatInterface;
    generatingNodeIds?: string[];
    config: ConfigInterface;
    activePath?: string[];
    omittedNodes?: Record<string, boolean>;
    auxiliary?: boolean;
    modelState?: ReasoningModelState;
    transport?: { endpoint: string; endpointURL: { protocol: string; hostname: string }; hasApiKey: boolean; apiVersion?: string; customHeaders?: Record<string, string>; chatId?: string; regenerate?: boolean; viaProxy?: boolean };
    capabilities?: { supportsReasoning: boolean; requiresReasoning: boolean };
  } = JSON.parse(json);
  if (input.modelState !== undefined) input.config = normalizeRemoteConfig(input.config, input.modelState);
  const messages = input.tokenMessages ?? (input.auxiliary ? input.messages ?? [] : getGenerationMessages(input));
  if (messages.length === 0) throw new Error('送信する本文がありません');
  const body = buildRequestBody(messages, input.config, input.modelState !== undefined
    ? getRequestReasoningCapabilities(input.config, input.modelState) : input.capabilities!,
    { stream: input.auxiliary ? false : input.config.stream });
  if (!input.transport) return JSON.stringify(body);
  const transport = prepareRequestTransport(input.transport.endpoint, input.config, input.transport.hasApiKey, input.transport.customHeaders, input.transport.apiVersion);
  applyOpenRouterControls(isOpenRouterURL(input.transport.endpointURL), input.config, body, transport.headers,
    { chatId: input.transport.chatId, regenerate: input.transport.regenerate, viaProxy: input.transport.viaProxy ?? false, auxiliary: input.auxiliary });
  return JSON.stringify({ ...transport, body });
};
