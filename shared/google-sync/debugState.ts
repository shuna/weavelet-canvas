import { DEBUG_DONE_TTL_MS, formatDebugLogLine, reduceDebugState, sortedDebugEntries, type DebugAction, type DebugState } from '../../src/utils/debugState';

type Input =
  | {operation: 'reduce'; state: DebugState; action: DebugAction}
  | {operation: 'display'; state: DebugState};

export function debugState(json: string): string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'reduce') return JSON.stringify(reduceDebugState(input.state, input.action));
  if (input.operation === 'display') return JSON.stringify({
    doneTTLms: DEBUG_DONE_TTL_MS,
    entries: sortedDebugEntries(input.state.entries),
    logs: input.state.logs.map((line) => ({...line, formatted: formatDebugLogLine(line)})),
  });
  throw new Error('Invalid debug state operation.');
}
