import { create } from 'zustand';
import { DEBUG_DONE_TTL_MS, reduceDebugState, type DebugEntry, type DebugLogLine } from '@utils/debugState';
export type { DebugStatus, DebugEntry, DebugLogLine } from '@utils/debugState';

interface DebugStore {
  entries: Record<string, DebugEntry>;
  logs: DebugLogLine[];
  update: (id: string, patch: Partial<Omit<DebugEntry, 'id'>>) => void;
  appendLog: (line: Omit<DebugLogLine, 'id' | 'timestamp'> & { timestamp?: number }) => void;
  clearLogs: () => void;
  remove: (id: string) => void;
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  entries: {},
  logs: [],
  update: (id, patch) => {
    const next = reduceDebugState(get(), {type: 'update', id, patch, updatedAt: Date.now()});
    const entry = next.entries[id];
    set(next);

    if (entry.status === 'done') {
      setTimeout(() => {
        const current = get().entries[id];
        if (current && current.status === 'done') {
          const { [id]: _, ...rest } = get().entries;
          set({ entries: rest });
        }
      }, DEBUG_DONE_TTL_MS);
    }
  },
  appendLog: (line) => {
    const timestamp = line.timestamp ?? Date.now();
    const id = `${timestamp}:${Math.random().toString(36).slice(2)}`;
    const next: DebugLogLine = {
      id,
      timestamp,
      source: line.source,
      level: line.level,
      message: line.message,
    };
    set(reduceDebugState(get(), {type: 'appendLog', line: next}));
  },
  clearLogs: () => set(reduceDebugState(get(), {type: 'clear'})),
  remove: (id) => set(reduceDebugState(get(), {type: 'remove', id})),
}));

/** Non-React helper for calling from plain functions */
export const debugReport = (
  id: string,
  patch: Partial<Omit<DebugEntry, 'id'>>
) => useDebugStore.getState().update(id, patch);

export const debugLog = (
  line: Omit<DebugLogLine, 'id' | 'timestamp'> & { timestamp?: number }
) => useDebugStore.getState().appendLog(line);
