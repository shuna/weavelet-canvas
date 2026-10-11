import type { ChatInterface, MessageInterface, TotalTokenUsed } from '@type/chat';
import type { OpenRouterStatsSlice } from '@store/openrouter-stats-slice';
import type { ContentStoreData } from '@utils/contentStore';
import { resolveContent } from '@utils/contentStore';
import countTokens from '@utils/messageUtils';
import { buildTokenUsageKey, countImageInputs } from '@utils/cost';

export async function rebuildSyncedUsage(chats: ChatInterface[], contentStore: ContentStoreData,
  local: Pick<OpenRouterStatsSlice, 'verifiedStats' | 'pendingVerifications'>) {
  const totalTokenUsed: TotalTokenUsed = {};
  const verifiedStats: OpenRouterStatsSlice['verifiedStats'] = {};
  const pendingVerifications: OpenRouterStatsSlice['pendingVerifications'] = {};
  const countedGenerations = new Set<string>();
  for (const chat of chats) {
    const tree = chat.branchTree;
    const completions = tree ? Object.values(tree.nodes).filter(node => node.role === 'assistant') :
      (chat.messages ?? []).map((message, index) => ({ ...message, id: String(index), index })).filter(message => message.role === 'assistant');
    for (const completion of completions) {
      const node = tree?.nodes[completion.id];
      const statsKey = `${chat.id}:::${completion.id}`;
      const generationId = node?.openRouterObservation?.generationId ?? local.verifiedStats[statsKey]?.generationId ?? local.pendingVerifications[statsKey]?.generationId;
      if (generationId) {
        if (local.verifiedStats[statsKey]?.generationId === generationId) verifiedStats[statsKey] = local.verifiedStats[statsKey];
        else if (local.pendingVerifications[statsKey]?.generationId === generationId) pendingVerifications[statsKey] = local.pendingVerifications[statsKey];
        else pendingVerifications[statsKey] = { generationId, chatId: chat.id, targetNodeId: completion.id,
          requestedAt: Date.now(), nextAttemptAt: Date.now(), attemptCount: 0, status: 'pending' };
        if (countedGenerations.has(generationId)) continue;
        countedGenerations.add(generationId);
      }
      const messages: MessageInterface[] = [];
      if (tree && node) {
        let cursor = node;
        while (cursor) {
          messages.unshift({ role: cursor.role, content: resolveContent(contentStore, cursor.contentHash) });
          if (!cursor.parentId) break;
          cursor = tree.nodes[cursor.parentId];
        }
      } else messages.push(...chat.messages.slice(0, Number(completion.id) + 1));
      const response = messages.pop();
      if (!response) continue;
      if (chat.config.systemPrompt) messages.unshift({ role: 'system', content: [{ type: 'text', text: chat.config.systemPrompt }] });
      const observed = verifiedStats[statsKey] ?? node?.openRouterObservation;
      // Older conversations do not retain the original request; recount their remaining context as an estimate.
      const promptTokens = observed?.promptTokens ?? await countTokens(messages, chat.config.model);
      const completionTokens = observed?.completionTokens ?? await countTokens([response], chat.config.model);
      const verified = verifiedStats[statsKey];
      const key = buildTokenUsageKey(verified?.model ?? chat.config.model, verified ? 'openrouter' : chat.config.providerId);
      const total = totalTokenUsed[key] ??= { promptTokens: 0, completionTokens: 0, imageTokens: 0 };
      total.promptTokens += promptTokens;
      total.completionTokens += completionTokens;
      total.imageTokens += countImageInputs(messages);
    }
  }
  return { totalTokenUsed, verifiedStats, pendingVerifications };
}
