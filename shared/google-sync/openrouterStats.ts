import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { buildVerifiedStatsKey, generationStatsRequest, parseVerifiedStats, recoverOpenRouterStats, scheduleOpenRouterStats, transitionOpenRouterStats,
  type StatsAction, type StatsState } from '../../src/utils/openrouterStats';

export function openRouterStats(json: string): string {
  const input = JSON.parse(json) as { operation: 'transition' | 'key' | 'schedule' | 'request' | 'parse' | 'recover';
    state: StatsState; action: StatsAction; now: number; chatId: string; targetNodeId: string;
    generationId: string; payload: unknown };
  switch (input.operation) {
    case 'transition': {
      const after = transitionOpenRouterStats(input.state,input.action,input.now);
      return JSON.stringify({ changes: diffJSONChanges(input.state,JSON.parse(JSON.stringify(after))) });
    }
    case 'key': return JSON.stringify({ key: buildVerifiedStatsKey(input.chatId,input.targetNodeId) });
    case 'schedule': return JSON.stringify(scheduleOpenRouterStats(input.state,input.now));
    case 'recover': return JSON.stringify({ changes:diffJSONChanges(input.state,recoverOpenRouterStats(input.state,input.now)) });
    case 'request': return JSON.stringify(generationStatsRequest(input.generationId));
    case 'parse': {
      const stats = parseVerifiedStats(input.payload,input.generationId,input.now);
      return JSON.stringify(stats && { stats });
    }
    default: throw new Error('Unknown OpenRouter stats operation.');
  }
}
