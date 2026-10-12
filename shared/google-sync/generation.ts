import { buildRequestBody } from '../../src/api/requestBody';
import { getSubmitContextMessages } from '../../src/utils/submitContext';
import type { ChatInterface, ConfigInterface, MessageInterface } from '../../src/types/chat';

export const generationRequest = (json: string): string => {
  const input: {
    messages: MessageInterface[];
    chat?: ChatInterface;
    generatingNodeIds?: string[];
    config: ConfigInterface;
    activePath?: string[];
    omittedNodes?: Record<string, boolean>;
    capabilities: { supportsReasoning: boolean; requiresReasoning: boolean };
  } = JSON.parse(json);
  const messages = getSubmitContextMessages(input.messages, input.messages.length,
    input.config.model, input.activePath, input.omittedNodes, input.config.systemPrompt,
    input.chat ? { chat: input.chat, generatingNodeIds: input.generatingNodeIds ?? [] } : undefined);
  if (messages.length === 0) throw new Error('送信する本文がありません');
  return JSON.stringify(buildRequestBody(messages, input.config, input.capabilities,
    { stream: input.config.stream }));
};
