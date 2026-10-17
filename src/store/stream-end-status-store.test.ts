import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ state: {} as any }));
vi.mock('./store', () => ({ default: {
  setState: (update: (state: any) => any) => { fixture.state = { ...fixture.state, ...update(fixture.state) }; },
} }));
import { useStreamEndStatusStore } from './stream-end-status-store';

beforeEach(() => {
  vi.useFakeTimers();
  fixture.state = { chats: ['a', 'b'].map(id => ({ id, branchTree: { nodes: {
    n: { id: 'n', role: 'assistant', contentHash: 'original' },
  } } })) };
});
afterEach(() => {
  useStreamEndStatusStore.getState().clearStatus('n');
  vi.useRealTimers();
});
it('retains per-bubble state after the transient notification expires and scopes writes by chat', () => {
  const store = useStreamEndStatusStore.getState();
  store.setStatus('n', 'streaming', 'a', { requestId: 'request-a', proxy: true });
  store.setStatus('n', 'error', 'a');
  vi.advanceTimersByTime(60_000);
  expect(useStreamEndStatusStore.getState().statuses.n).toBeUndefined();
  expect(fixture.state.chats[0].branchTree.nodes.n.streamState).toMatchObject({ reason: 'error', requestId: 'request-a', proxy: true });
  expect(fixture.state.chats[1].branchTree.nodes.n.streamState).toBeUndefined();
  expect(fixture.state.chats[0].branchTree.nodes.n.contentHash).toBe('original');
});
it('clears the previous request identity when the bubble starts a new submission', () => {
  const store = useStreamEndStatusStore.getState();
  store.setStatus('n', 'streaming', 'a', { requestId: 'old', proxy: true });
  store.setStatus('n', 'streaming', 'a');
  expect(fixture.state.chats[0].branchTree.nodes.n.streamState.requestId).toBeUndefined();
  store.setStatus('n', 'streaming', 'a', { requestId: 'new', proxy: true });
  store.setStatus('n', 'recovered', 'a');
  expect(fixture.state.chats[0].branchTree.nodes.n.streamState).toMatchObject({ reason: 'recovered', requestId: 'new' });
});
