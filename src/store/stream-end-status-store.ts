import { create } from 'zustand';

import useStore from './store';
import type { StreamEndReason } from '@type/chat';
export type { StreamEndReason } from '@type/chat';

// Transient notifications supplement the per-node state saved with chat data.
/** How long the indicator stays visible (ms) */
const INDICATOR_TTL_MS = 8_000;

interface StreamEndStatusStore {
  statuses: Record<string, StreamEndReason>;
  setStatus: (nodeId: string, reason: StreamEndReason, chatId?: string, request?: { requestId: string; proxy: boolean; createdAt?: number }) => void;
  clearStatus: (nodeId: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useStreamEndStatusStore = create<StreamEndStatusStore>((set, get) => ({
  statuses: {},
  setStatus: (nodeId, reason, chatId, request) => {
    if (chatId) useStore.setState(state => {
      const index = state.chats?.findIndex(chat => chat.id === chatId) ?? -1;
      const chat = state.chats?.[index];
      const node = chat?.branchTree?.nodes[nodeId];
      if (!chat?.branchTree || !node) return state;
      const previous = reason === 'streaming' && !request ? undefined : node.streamState;
      const chats = [...state.chats!];
      chats[index] = { ...chat, branchTree: { ...chat.branchTree, nodes: {
        ...chat.branchTree.nodes,
        [nodeId]: { ...node, streamState: {
          ...previous, ...request, reason, createdAt: request?.createdAt ?? previous?.createdAt ?? Date.now(),
        } },
      } } };
      return { chats };
    });
    // Clear any existing timer
    const existing = timers.get(nodeId);
    if (existing) clearTimeout(existing);

    set((state) => ({
      statuses: { ...state.statuses, [nodeId]: reason },
    }));

    // Auto-clear after TTL (except for max_tokens / recovered_partial which persist longer)
    const ttl = reason === 'max_tokens' || reason === 'recovered_partial'
      ? INDICATOR_TTL_MS * 2
      : INDICATOR_TTL_MS;

    const timer = setTimeout(() => {
      timers.delete(nodeId);
      const current = get().statuses[nodeId];
      if (current === reason) {
        set((state) => {
          const next = { ...state.statuses };
          delete next[nodeId];
          return { statuses: next };
        });
      }
    }, ttl);
    timers.set(nodeId, timer);
  },
  clearStatus: (nodeId) => {
    const existing = timers.get(nodeId);
    if (existing) {
      clearTimeout(existing);
      timers.delete(nodeId);
    }
    set((state) => {
      const next = { ...state.statuses };
      delete next[nodeId];
      return { statuses: next };
    });
  },
}));
