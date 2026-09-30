import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  peekBufferedReasoning,
  subscribeToStreaming,
} from '@utils/streamingBuffer';

const EMPTY_UNSUB = () => {};

/**
 * Subscribe to live streaming reasoning text for a specific node.
 *
 * Returns the latest reasoning text from the streaming buffer when the node
 * is actively streaming, or `undefined` when no buffer exists.
 *
 * Uses `useSyncExternalStore` so that ONLY the component calling this hook
 * re-renders on each chunk — the Zustand store is not involved.
 */
export function useStreamingReasoning(
  nodeId: string | undefined,
  visible = true,
  expanded = true
): string | undefined {
  const snapshot = useRef<{ nodeId: string | undefined; value: string | undefined }>({ nodeId, value: undefined });
  if (snapshot.current.nodeId !== nodeId) snapshot.current = { nodeId, value: undefined };
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!nodeId || !visible) return EMPTY_UNSUB;
      return subscribeToStreaming(nodeId, callback, 250, true, !expanded);
    },
    [nodeId, visible, expanded]
  );

  const getSnapshot = useCallback(() => {
    if (!nodeId) return undefined;
    if (!visible || (!expanded && snapshot.current.value)) return snapshot.current.value;
    snapshot.current.value = peekBufferedReasoning(nodeId);
    return snapshot.current.value;
  }, [nodeId, visible, expanded]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
