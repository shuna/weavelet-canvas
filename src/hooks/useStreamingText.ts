import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  peekBufferedContent,
  subscribeToStreaming,
} from '@utils/streamingBuffer';
import { isTextContent } from '@type/chat';

const EMPTY_UNSUB = () => {};

/**
 * Subscribe to live streaming text for a specific node.
 *
 * Returns the latest text from the streaming buffer when the node is actively
 * streaming, or `undefined` when no buffer exists (not streaming / finalized).
 *
 * Uses `useSyncExternalStore` so that ONLY the component calling this hook
 * re-renders on each chunk — the Zustand store is not involved.
 */
export function useStreamingText(
  chatId: string,
  nodeId: string | undefined,
  visible = true
): string | undefined {
  const snapshot = useRef<{ key: string; value: string | undefined }>({ key: JSON.stringify([chatId, nodeId]), value: undefined });
  const key = JSON.stringify([chatId, nodeId]);
  if (snapshot.current.key !== key) snapshot.current = { key, value: undefined };
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!nodeId || !visible) return EMPTY_UNSUB;
      return subscribeToStreaming(chatId, nodeId, callback);
    },
    [chatId, nodeId, visible]
  );

  const getSnapshot = useCallback(() => {
    if (!nodeId) return undefined;
    if (!visible) return snapshot.current.value;
    const content = peekBufferedContent(chatId, nodeId);
    if (!content || content.length === 0) return undefined;
    const first = content[0];
    snapshot.current.value = isTextContent(first) ? first.text : undefined;
    return snapshot.current.value;
  }, [chatId, nodeId, visible]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
