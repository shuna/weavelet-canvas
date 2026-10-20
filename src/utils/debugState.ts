export type DebugStatus = 'idle' | 'active' | 'error' | 'done';

export interface DebugEntry {
  id: string;
  label: string;
  status: DebugStatus;
  detail?: string;
  updatedAt: number;
}

export interface DebugLogLine {
  id: string;
  timestamp: number;
  source: string;
  level: string;
  message: string;
}

export type DebugState = {entries: Record<string, DebugEntry>; logs: DebugLogLine[]};
export type DebugAction =
  | {type: 'update'; id: string; patch: Partial<Omit<DebugEntry, 'id'>>; updatedAt: number}
  | {type: 'appendLog'; line: DebugLogLine}
  | {type: 'clear'}
  | {type: 'remove'; id: string};

const MAX_LOG_LINES = 500;
export const DEBUG_DONE_TTL_MS = 30_000;

export function reduceDebugState(state: DebugState, action: DebugAction): DebugState {
  switch (action.type) {
    case 'update': {
      const previous = state.entries[action.id];
      const entry: DebugEntry = {
        id: action.id,
        label: action.patch.label ?? previous?.label ?? action.id,
        status: action.patch.status ?? previous?.status ?? 'idle',
        detail: action.patch.detail ?? previous?.detail,
        updatedAt: action.updatedAt,
      };
      return {...state, entries: {...state.entries, [action.id]: entry}};
    }
    case 'appendLog': return {...state, logs: [...state.logs, action.line].slice(-MAX_LOG_LINES)};
    case 'clear': return {
      entries: Object.fromEntries(Object.entries(state.entries).filter(([, entry]) => entry.status !== 'done')),
      logs: [],
    };
    case 'remove': {
      const {[action.id]: _, ...entries} = state.entries;
      return {...state, entries};
    }
  }
}

export function sortedDebugEntries(entries: Record<string, DebugEntry>): DebugEntry[] {
  return Object.values(entries).sort((left, right) => {
    if (left.status === 'active' && right.status !== 'active') return -1;
    if (right.status === 'active' && left.status !== 'active') return 1;
    return right.updatedAt - left.updatedAt;
  });
}

export function formatDebugLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export function formatDebugLogLine(line: Pick<DebugLogLine, 'timestamp' | 'source' | 'level' | 'message'>): string {
  return `${formatDebugLogTime(line.timestamp)} [${line.source}] ${line.level} ${line.message}`;
}
