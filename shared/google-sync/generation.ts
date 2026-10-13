import { materializeActivePath } from '../../src/utils/branchUtils';
import type { ContentStoreData } from '../../src/utils/contentStore';
import { buildRequestBody } from '../../src/api/requestBody';
import { getSubmitContextMessages } from '../../src/utils/submitContext';
import type { ChatInterface, ConfigInterface, MessageInterface } from '../../src/types/chat';

export const generationRequest = (json: string): string => {
  const input: {
    messages?: MessageInterface[];
    contentStore?: ContentStoreData;
    chat?: ChatInterface;
    generatingNodeIds?: string[];
    config: ConfigInterface;
    activePath?: string[];
    omittedNodes?: Record<string, boolean>;
    capabilities: { supportsReasoning: boolean; requiresReasoning: boolean };
  } = JSON.parse(json);
  const path = input.activePath ?? input.chat?.branchTree?.activePath;
  let chat = input.chat;
  if (chat?.branchTree && input.contentStore) {
    const branchTree = { ...chat.branchTree, activePath: path! };
    chat = { ...chat, branchTree, messages: materializeActivePath(branchTree, input.contentStore) };
  }
  const projected = chat?.messages ?? input.messages ?? [];
  const messages = getSubmitContextMessages(projected, projected.length,
    input.config.model, path, input.omittedNodes ?? chat?.omittedNodes, input.config.systemPrompt,
    chat ? { chat, generatingNodeIds: input.generatingNodeIds ?? [] } : undefined);
  if (messages.length === 0) throw new Error('送信する本文がありません');
  return JSON.stringify(buildRequestBody(messages, input.config, input.capabilities,
    { stream: input.config.stream }));
};
