import { create } from 'zustand';
import type { BubbleSummary } from '@type/chat';

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
