import { create } from 'zustand';
import type { BubbleSummary } from '@type/chat';
import useStore from '@store/store';
import { getAppliedBubbleSummaries, isBubbleSummary, resolveValidSummary } from '@utils/bubbleSummary';

// Remember which saved summary the range controls select; persisted send state determines display.
export const useSummaryDisplay = create<{
  chosen: Record<string, string>;
  choose: (chatId: string, summary: BubbleSummary, showSummary?: boolean) => void;
}>(set => ({
  chosen: {},
  choose: (chatId, summary, showSummary = true) => {
    useStore.getState().setSummaryForSubmit(chatId, summary.id, showSummary);
    set(state => ({ chosen: { ...state.chosen, ...Object.fromEntries(summary.sources.map(source => [`${chatId}:${source.nodeId}`, summary.id])) } }));
  },
}));

// Keep the capsule and body on the same saved summary and source-validity state.
export function useBubbleSummary(nodeId?: string) {
  const currentChatIndex = useStore(state => state.currentChatIndex);
  const chat = useStore(state => state.chats?.[state.currentChatIndex]);
  const maps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const chosen = useSummaryDisplay(state => state.chosen);
  const candidates = (Array.isArray(chat?.summaries) ? chat?.summaries ?? [] : []).filter(isBubbleSummary)
    .filter(summary => summary.sources.some(source => source.nodeId === nodeId));
  const effectiveChat = chat ? { ...chat, omittedNodes: maps[String(currentChatIndex)] ?? chat.omittedNodes } : undefined;
  const generating = Object.values(sessions).filter(session => session.chatId === chat?.id).map(session => session.targetNodeId);
  const applied = effectiveChat ? getAppliedBubbleSummaries(effectiveChat, chat?.messages.length, generating) : [];
  const summary = candidates.find(value => applied.some(item => item.summary.id === value.id))
    ?? candidates.find(value => value.id === chosen[`${chat?.id}:${nodeId}`]) ?? candidates[candidates.length - 1];
  const range = effectiveChat && summary ? resolveValidSummary(effectiveChat, summary, generating) : null;
  const tab = applied.some(value => value.summary.id === summary?.id) ? summary?.format === 'compact' ? 'compact' : 'summary' : 'original';
  const versions = candidates.filter(value => summary && value.sources.length === summary.sources.length && value.sources.every((source, index) => source.nodeId === summary.sources[index].nodeId));
  const readable = versions.find(value => value.id === chosen[`${chat?.id}:${nodeId}`] && value.format !== 'compact') ?? versions.filter(value => value.format !== 'compact').at(-1);
  const compact = versions.find(value => value.id === chosen[`${chat?.id}:${nodeId}`] && value.format === 'compact') ?? versions.filter(value => value.format === 'compact').at(-1);
  const changeTab = (value: 'original' | 'summary' | 'compact') => {
    const next = value === 'original' ? summary : value === 'compact' ? compact : readable;
    if (!chat || !next) return;
    useSummaryDisplay.getState().choose(chat.id, next, value !== 'original');
  };
  return { chat, candidates, summary, effectiveChat, generating, range, readable, compact, tab, changeTab };
}
