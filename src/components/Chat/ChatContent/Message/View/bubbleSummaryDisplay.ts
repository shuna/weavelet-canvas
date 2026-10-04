import { create } from 'zustand';
import type { BubbleSummary } from '@type/chat';
import useStore from '@store/store';
import { isBubbleSummary, resolveValidSummary } from '@utils/bubbleSummary';

// Shared only by the bubbles in a range; display choices are never persisted or sent.
export const useSummaryDisplay = create<{
  tabs: Record<string, 'original' | 'summary'>;
  chosen: Record<string, string>;
  select: (key: string, tab: 'original' | 'summary') => void;
  choose: (chatId: string, summary: BubbleSummary) => void;
}>(set => ({
  tabs: {}, chosen: {},
  select: (key, tab) => set(state => ({ tabs: { ...state.tabs, [key]: tab } })),
  choose: (chatId, summary) => set(state => ({
    chosen: { ...state.chosen, ...Object.fromEntries(summary.sources.map(source => [`${chatId}:${source.nodeId}`, summary.id])) },
    tabs: { ...state.tabs, ...Object.fromEntries(summary.sources.map(source => state.chosen[`${chatId}:${source.nodeId}`]).filter(id => id && id !== summary.id).map(id => [`${chatId}:${id}`, 'original' as const])) },
  })),
}));

// Keep the capsule and body on the same saved summary and source-validity state.
export function useBubbleSummary(nodeId?: string) {
  const currentChatIndex = useStore(state => state.currentChatIndex);
  const chat = useStore(state => state.chats?.[state.currentChatIndex]);
  const maps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const tabs = useSummaryDisplay(state => state.tabs);
  const chosen = useSummaryDisplay(state => state.chosen);
  const candidates = (Array.isArray(chat?.summaries) ? chat?.summaries ?? [] : []).filter(isBubbleSummary)
    .filter(summary => summary.sources.some(source => source.nodeId === nodeId));
  const summary = candidates.find(value => value.id === chosen[`${chat?.id}:${nodeId}`]) ?? candidates[candidates.length - 1];
  const effectiveChat = chat ? { ...chat, omittedNodes: maps[String(currentChatIndex)] ?? chat.omittedNodes } : undefined;
  const generating = Object.values(sessions).filter(session => session.chatId === chat?.id).map(session => session.targetNodeId);
  const range = effectiveChat && summary ? resolveValidSummary(effectiveChat, summary, generating) : null;
  const key = summary && chat ? `${chat.id}:${summary.id}` : '';
  const tab = range ? tabs[key] ?? 'original' : 'original';
  const changeTab = (value: 'original' | 'summary') => {
    if (!chat || !summary) return;
    useSummaryDisplay.getState().choose(chat.id, summary);
    useSummaryDisplay.getState().select(key, value);
  };
  return { chat, candidates, summary, effectiveChat, generating, range, tab, changeTab };
}
