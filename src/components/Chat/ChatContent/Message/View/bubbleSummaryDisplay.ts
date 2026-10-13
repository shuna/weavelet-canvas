import { create } from 'zustand';
import type { BubbleSummary } from '@type/chat';
import useStore from '@store/store';
import { useWorkspaceStore, useWorkspaceReadOnly, useWorkspaceScope } from '@store/workspaceScope';
import { describeBubbleSummary } from '@utils/bubbleSummaryOperations';

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
  const useStore = useWorkspaceStore();
  const readOnly = useWorkspaceReadOnly();
  const scope = useWorkspaceScope();
  const currentChatIndex = useStore(state => state.currentChatIndex);
  const chat = useStore(state => state.chats?.[state.currentChatIndex]);
  const maps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const chosen = useSummaryDisplay(state => state.chosen);
  const effectiveChat = chat ? { ...chat, omittedNodes: maps[String(currentChatIndex)] ?? chat.omittedNodes } : undefined;
  const generating = Object.values(sessions).filter(session => session.chatId === chat?.id).map(session => session.targetNodeId);
  const described = effectiveChat && nodeId ? describeBubbleSummary(effectiveChat, nodeId, generating,
    !readOnly ? chosen[`${chat?.id}:${nodeId}`] : undefined) : undefined;
  const { candidates = [], summary, range = null, readable, compact } = described ?? {};
  const defaultTab = described?.tab ?? 'original';
  const tab = readOnly ? scope?.summaryTabs?.[`${chat?.id}:${nodeId}`] ?? defaultTab : defaultTab;
  const changeTab = (value: 'original' | 'summary' | 'compact') => {
    const next = value === 'original' ? summary : value === 'compact' ? compact : readable;
    if (!chat || !next) return;
    if (readOnly) { scope?.setSummaryTab?.(`${chat.id}:${nodeId}`, value); return; }
    useSummaryDisplay.getState().choose(chat.id, next, value !== 'original');
  };
  return { chat, candidates, summary: readOnly ? (tab === 'summary' ? readable : tab === 'compact' ? compact : summary) ?? summary : summary, effectiveChat, generating, range, readable, compact, tab, changeTab };
}
