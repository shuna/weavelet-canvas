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
  chatId: string,
  nodeId: string | undefined,
  visible = true,
  expanded = true
): string | undefined {
  const snapshot = useRef<{ key: string; value: string | undefined }>({ key: JSON.stringify([chatId, nodeId]), value: undefined });
  const key = JSON.stringify([chatId, nodeId]);
  if (snapshot.current.key !== key) snapshot.current = { key, value: undefined };
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!nodeId || !visible) return EMPTY_UNSUB;
      return subscribeToStreaming(chatId, nodeId, callback, 250, true, !expanded);
    },
    [chatId, nodeId, visible, expanded]
  );

  const getSnapshot = useCallback(() => {
    if (!nodeId) return undefined;
    if (!visible || (!expanded && snapshot.current.value)) return snapshot.current.value;
    snapshot.current.value = peekBufferedReasoning(chatId, nodeId);
    return snapshot.current.value;
  }, [chatId, nodeId, visible, expanded]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
