import type { ChatInterface, MessageInterface, OpenRouterObservation, TotalTokenUsed } from '@type/chat';
import { getSubmitContextMessages } from './submitContext';
import { addTokenUsage, countImageInputs } from './chatTitle';

export type PreparedSubmitUsage = {
  model: string; providerId?: string;
} & ({ kind: 'observed'; promptTokens: number; completionTokens: number }
  | { kind: 'estimated'; promptMessages: MessageInterface[]; completionMessage: MessageInterface });

export function prepareSubmitUsage(chat: ChatInterface, targetNodeId: string,
  generatingNodeIds: string[] = [targetNodeId]): PreparedSubmitUsage | undefined {
  const index = chat.branchTree?.activePath.indexOf(targetNodeId) ?? -1;
  if (index < 0) return;
  const { model, providerId, systemPrompt } = chat.config;
  const observation = chat.branchTree?.nodes[targetNodeId]?.openRouterObservation;
  if (observation?.promptTokens !== undefined && observation.completionTokens !== undefined) {
    return { kind: 'observed', model, providerId, promptTokens: observation.promptTokens,
      completionTokens: observation.completionTokens };
  }
  const completionMessage = chat.messages[index];
  if (!completionMessage) return;
  return { kind: 'estimated', model, providerId, completionMessage,
    promptMessages: getSubmitContextMessages(chat.messages, index, model, chat.branchTree?.activePath,
      chat.omittedNodes ?? {}, systemPrompt, { chat, generatingNodeIds }) };
}

export function addPreparedSubmitUsage(total: TotalTokenUsed, prepared: PreparedSubmitUsage,
  counts?: { promptTokens: number; completionTokens: number }): TotalTokenUsed {
  if (prepared.kind === 'estimated') {
    if (!counts) throw new Error('Missing estimated token counts.');
    return addTokenUsage(total, prepared.model, prepared.providerId,
      counts.promptTokens, counts.completionTokens, countImageInputs(prepared.promptMessages));
  }
  const key = prepared.providerId ? `${prepared.model}:::${prepared.providerId}` : prepared.model;
  const prior = total[key] ?? { promptTokens: 0, completionTokens: 0, imageTokens: 0 };
  return { ...total, [key]: { ...prior,
    promptTokens: (prior.promptTokens ?? 0) + prepared.promptTokens,
    completionTokens: (prior.completionTokens ?? 0) + prepared.completionTokens,
  } };
}

export function withOpenRouterObservation(chat: ChatInterface, nodeId: string,
  patch: OpenRouterObservation): ChatInterface | undefined {
  if (!Object.keys(patch).length) return;
  const tree = chat.branchTree;
  const node = tree?.nodes[nodeId];
  if (!tree || !node) return;
  return { ...chat, branchTree: { ...tree, nodes: { ...tree.nodes, [nodeId]: {
    ...node, openRouterObservation: { ...node.openRouterObservation, ...patch },
  } } } };
}
