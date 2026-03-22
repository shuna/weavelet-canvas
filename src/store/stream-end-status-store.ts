import { create } from 'zustand';

/**
 * Transient (non-persisted) store that tracks how each streaming message ended.
 * Used to show a brief completion/interruption indicator in the UI.
 */

export type StreamEndReason =
  | 'completed'      // LLM finished naturally (finish_reason: stop / [DONE])
  | 'max_tokens'     // LLM hit max_tokens limit (finish_reason: length)
  | 'interrupted'    // User stopped or network abort
  | 'error'          // Stream error / timeout
  | 'recovered'      // Recovered from proxy (may be partial)
  | 'recovered_partial'; // Recovered from proxy but incomplete

/** How long the indicator stays visible (ms) */
const INDICATOR_TTL_MS = 8_000;

interface StreamEndStatusStore {
  statuses: Record<string, StreamEndReason>;
  setStatus: (nodeId: string, reason: StreamEndReason) => void;
  clearStatus: (nodeId: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useStreamEndStatusStore = create<StreamEndStatusStore>((set, get) => ({
  statuses: {},
  setStatus: (nodeId, reason) => {
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
