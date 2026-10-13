import { getGenerationMessages, type GenerationContextInput } from './generation';
import { countImageInputs } from '../../src/utils/chatTitle';
import { buildTokenUsageKey } from '../../src/utils/costCore';
import type { ChatInterface, OpenRouterObservation, TotalTokenUsed } from '../../src/types/chat';
import { addPreparedSubmitUsage, liveCompletionForCounting, prepareSubmitUsage, withOpenRouterObservation } from '../../src/utils/generationUsage';
import { estimateTokensByChars } from '../../src/utils/chatTitle';
import { diffJSONChanges } from '../../src/utils/jsonChanges';

export function generationUsagePlan(json: string): string {
  const input = JSON.parse(json) as {chat: ChatInterface; targetNodeId: string; generatingNodeIds?: string[]};
  return JSON.stringify(prepareSubmitUsage(input.chat, input.targetNodeId, input.generatingNodeIds) ?? null);
}

export function generationLiveUsagePlan(json: string): string {
  const input = JSON.parse(json) as GenerationContextInput & {completionParts: ChatInterface['messages'][number]['content']};
  return JSON.stringify({model: input.config.model, promptMessages: getGenerationMessages(input),
    completionMessage: liveCompletionForCounting({role: 'assistant', content: input.completionParts}) ?? null});
}

export function generationUsage(json: string): string {
  const input = JSON.parse(json) as { chat: ChatInterface; targetNodeId: string;
    countTotalTokens: boolean; totalTokenUsed: TotalTokenUsed; generatingNodeIds?: string[];
    counts?: {promptTokens: number; completionTokens: number} };
  if (!input.countTotalTokens) return JSON.stringify({ changes: [] });
  const prepared = prepareSubmitUsage(input.chat, input.targetNodeId, input.generatingNodeIds);
  if (!prepared) return JSON.stringify({ changes: [] });
  const totals = input.totalTokenUsed ?? {};
  const updated = addPreparedSubmitUsage(totals, prepared, prepared.kind === 'estimated' ? input.counts ?? {
    promptTokens: estimateTokensByChars(prepared.promptMessages),
    completionTokens: estimateTokensByChars([prepared.completionMessage]),
  } : undefined);
  return JSON.stringify({ changes: diffJSONChanges({ totalTokenUsed: totals }, { totalTokenUsed: updated }),
    usageKey: prepared.providerId ? `${prepared.model}:::${prepared.providerId}` : prepared.model,
    counterFields: prepared.kind === 'observed' ? ['promptTokens', 'completionTokens']
      : ['promptTokens', 'completionTokens', 'imageTokens'] });
}

export function generationObservation(json: string): string {
  const input = JSON.parse(json) as { chat: ChatInterface; targetNodeId: string; observation: OpenRouterObservation };
  const updated = withOpenRouterObservation(input.chat, input.targetNodeId, input.observation);
  return JSON.stringify({ changes: updated ? diffJSONChanges(input.chat, updated) : [] });
}

/** Mirrors the live Web usage overlay; never writes saved totals. */
export function generationLiveUsage(json: string): string {
  const input = JSON.parse(json) as GenerationContextInput & { completionParts: ChatInterface['messages'][number]['content']; counts?: {promptTokens: number; completionTokens: number} };
  const prompt = getGenerationMessages(input);
  const completionMessage = { role: 'assistant' as const, content: input.completionParts };
  const countableCompletion = liveCompletionForCounting(completionMessage);
  const completionTokens = countableCompletion ? input.counts?.completionTokens ?? estimateTokensByChars([countableCompletion]) : 0;
  return JSON.stringify({ [buildTokenUsageKey(input.config.model, input.config.providerId)]: {
    promptTokens: input.counts?.promptTokens ?? estimateTokensByChars(prompt), completionTokens, imageTokens: countImageInputs(prompt),
  } });
}
