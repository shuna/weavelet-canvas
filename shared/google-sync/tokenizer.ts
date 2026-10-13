import { ensureNonZeroTokenCount, fallbackLimitMessageIndices } from '../../src/utils/tokenizerCountingCore';
import { estimateTokensByChars } from '../../src/utils/chatTitle';
import { remoteModelContextInfo } from '../../src/utils/remoteModelLimits';
import { getPromptBudgetForContext, fitsContextWindow } from '../../src/utils/tokenBudget';
import { LIVE_TOKEN_RECOUNT_THROTTLE_MS } from '../../src/utils/liveTokenUsage';
import type { ConfigInterface, MessageInterface } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';

export function tokenizerOperation(json: string): string {
  const input = JSON.parse(json) as {operation: 'ensureCount' | 'fallbackCount' | 'fallbackLimit' | 'throttle'; messages: MessageInterface[]; count: number; limit: number};
  switch (input.operation) {
    case 'ensureCount': return JSON.stringify(ensureNonZeroTokenCount(input.count, input.messages));
    case 'fallbackCount': return JSON.stringify(estimateTokensByChars(input.messages));
    case 'fallbackLimit': return JSON.stringify(fallbackLimitMessageIndices(input.messages, input.limit));
    case 'throttle': return JSON.stringify(LIVE_TOKEN_RECOUNT_THROTTLE_MS);
  }
  throw new Error('Unknown tokenizer operation.');
}

export function tokenBudgetOperation(json: string): string {
  const input = JSON.parse(json) as {config: ConfigInterface; modelState?: ReasoningModelState; promptTokens?: number};
  const context = remoteModelContextInfo(input.modelState ?? {}, input.config.model, input.config.providerId);
  return JSON.stringify({...context, promptBudget: getPromptBudgetForContext(context.contextLength, input.config.max_tokens),
    ...(input.promptTokens === undefined ? {} : {fits: fitsContextWindow(input.promptTokens, context.contextLength, input.config.max_tokens)})});
}
