import type { ChatInterface, ContentInterface, TextContentInterface, ReasoningContentInterface } from '@type/chat';
import { isTextContent } from '@type/chat';
import { cloneChatAt } from '@store/branch-domain';
import type { ContentStoreData } from './contentStore';
import { addContent } from './contentStore';
import { materializeActivePath } from './branchUtils';

const STREAMING_CONTENT_HASH_PREFIX = '__streaming:';

interface StreamingBufferEntry {
  chatId: string;
  content: ContentInterface[];
  reasoning: string;
}

const streamingBuffers = new Map<string, StreamingBufferEntry>();

const cloneContentItem = (content: ContentInterface): ContentInterface => {
  if (content.type === 'image_url') return { ...content, image_url: { ...content.image_url } };
  return { ...content } as ContentInterface;
};

const cloneContent = (content: ContentInterface[]): ContentInterface[] =>
  content.map(cloneContentItem);

const upsertTextContent = (
  content: ContentInterface[],
  updater: (text: string) => string
): ContentInterface[] => {
  if (content.length === 0) {
    return [{ type: 'text', text: updater('') }];
  }

  const [first, ...rest] = content;
  if (isTextContent(first)) {
    const updatedFirst: TextContentInterface = {
      ...first,
      text: updater(first.text),
    };
    return [updatedFirst, ...rest.map(cloneContentItem)];
  }

  return [{ type: 'text', text: updater('') }, ...content.map(cloneContentItem)];
};

const bufferKey = (chatId: string, nodeId: string): string => JSON.stringify([chatId, nodeId]);

export const createStreamingContentHash = (chatId: string, nodeId: string): string =>
  `${STREAMING_CONTENT_HASH_PREFIX}${bufferKey(chatId, nodeId)}`;

export const isStreamingContentHash = (hash: string): boolean => hash.startsWith(STREAMING_CONTENT_HASH_PREFIX);

export const getStreamingTargetFromHash = (hash: string): { chatId: string; nodeId: string } | null => {
  if (!isStreamingContentHash(hash)) return null;
  try {
    const target = JSON.parse(hash.slice(STREAMING_CONTENT_HASH_PREFIX.length));
    return Array.isArray(target) && target.length === 2 && target.every(value => typeof value === 'string')
      ? { chatId: target[0], nodeId: target[1] } : null;
  } catch { return null; }
};

export const initializeStreamingBuffer = (
  chatId: string,
  nodeId: string,
  content: ContentInterface[],
): void => {
  const key = bufferKey(chatId, nodeId);
  // Extract existing reasoning text from content if present
  const existingReasoning = content
    .filter((c): c is ReasoningContentInterface => c.type === 'reasoning')
    .map((c) => c.text)
    .join('');
  streamingBuffers.set(key, { chatId, content: cloneContent(content), reasoning: existingReasoning });
  ensureSnapshotFlushRunning();
};

export const appendToStreamingBuffer = (chatId: string, nodeId: string, text: string): void => {
  const key = bufferKey(chatId, nodeId);
  const entry = streamingBuffers.get(key);
  const current = entry?.content ?? [];
  streamingBuffers.set(key, {
    chatId,
    content: upsertTextContent(current, (existing) => existing + text),
    reasoning: entry?.reasoning ?? '',
  });
};

/**
 * Replace the text in the streaming buffer with a full snapshot.
 * Used by local model generation where the worker sends currentText (full text-so-far)
 * rather than incremental deltas.
 */
export const setStreamingBufferText = (chatId: string, nodeId: string, text: string): void => {
  const key = bufferKey(chatId, nodeId);
  const entry = streamingBuffers.get(key);
  const current = entry?.content ?? [];
  streamingBuffers.set(key, {
    chatId,
    content: upsertTextContent(current, () => text),
    reasoning: entry?.reasoning ?? '',
  });
};

export const appendReasoningToStreamingBuffer = (chatId: string, nodeId: string, text: string): void => {
  const key = bufferKey(chatId, nodeId);
  const entry = streamingBuffers.get(key);
  if (!entry) return;
  entry.reasoning += text;
};

export const getBufferedContent = (chatId: string, nodeId: string): ContentInterface[] | undefined => {
  const key = bufferKey(chatId, nodeId);
  const entry = streamingBuffers.get(key);
  return entry ? cloneContent(entry.content) : undefined;
};

/** Read-only reference to buffered content. Caller must NOT mutate the result. */
export const peekBufferedContent = (chatId: string, nodeId: string): ContentInterface[] | undefined => {
  const key = bufferKey(chatId, nodeId);
  return streamingBuffers.get(key)?.content;
};

/** Read-only reference to buffered reasoning text. */
export const peekBufferedReasoning = (chatId: string, nodeId: string): string | undefined => {
  const key = bufferKey(chatId, nodeId);
  const r = streamingBuffers.get(key)?.reasoning;
  return r || undefined;
};

export const finalizeStreamingBuffer = (chatId: string, nodeId: string): ContentInterface[] => {
  const key = bufferKey(chatId, nodeId);
  const entry = streamingBuffers.get(key);
  const content = entry ? cloneContent(entry.content) : [];

  // Prepend reasoning content if present
  const result = entry?.reasoning
    ? [
        { type: 'reasoning', text: entry.reasoning } as ReasoningContentInterface,
        ...content.filter((c) => c.type !== 'reasoning'),
      ]
    : content;

  streamingBuffers.delete(key);
  clearStreamingNotification(key);
  streamingListeners.delete(key);
  return result;
};

export const discardStreamingBuffer = (chatId: string, nodeId: string): void => {
  finalizeStreamingBuffer(chatId, nodeId);
};

export const hasActiveStreamingBuffers = (): boolean => streamingBuffers.size > 0;

/** Returns the set of chatIds that currently have active streaming buffers. */
export const getStreamingChatIds = (): Set<string> => new Set([...streamingBuffers.values()].map(entry => entry.chatId));

export const isBufferingNode = (chatId: string, nodeId: string): boolean => streamingBuffers.has(bufferKey(chatId, nodeId));

export const clearStreamingBuffersForTest = (): void => {
  for (const nodeId of streamingListeners.keys()) clearStreamingNotification(nodeId);
  streamingBuffers.clear();
  streamingListeners.clear();
  stopSnapshotFlush();
};

// ---------------------------------------------------------------------------
// Periodic snapshot flush — persists streaming buffer to IndexedDB every N seconds
// ---------------------------------------------------------------------------

const SNAPSHOT_FLUSH_INTERVAL_MS = 5_000;

let snapshotFlushTimer: ReturnType<typeof setInterval> | null = null;
let snapshotFlushCallback: (() => void) | null = null;

/**
 * Register a callback to be invoked on each snapshot flush tick.
 * Call once at app bootstrap.  The timer auto-starts/stops based on
 * whether there are active streaming buffers.
 */
export const registerSnapshotFlushCallback = (onFlush: () => void): void => {
  snapshotFlushCallback = onFlush;
};

/** Called internally when a streaming buffer is first created. */
export const ensureSnapshotFlushRunning = (): void => {
  if (snapshotFlushTimer != null || !snapshotFlushCallback) return;
  snapshotFlushTimer = setInterval(() => {
    if (streamingBuffers.size === 0) {
      stopSnapshotFlush();
      return;
    }
    snapshotFlushCallback?.();
  }, SNAPSHOT_FLUSH_INTERVAL_MS);
};

export const stopSnapshotFlush = (): void => {
  if (snapshotFlushTimer != null) {
    clearInterval(snapshotFlushTimer);
    snapshotFlushTimer = null;
  }
};

// ---------------------------------------------------------------------------
// Streaming subscription (useSyncExternalStore support)
// ---------------------------------------------------------------------------

interface StreamingListener {
  notify: () => void;
  clear: () => void;
}
const streamingListeners = new Map<string, Set<StreamingListener>>();

const clearStreamingNotification = (nodeId: string): void => {
  streamingListeners.get(nodeId)?.forEach(listener => listener.clear());
};

export const notifyStreamingUpdate = (chatId: string, nodeId: string): void => {
  const key = bufferKey(chatId, nodeId);
  streamingListeners.get(key)?.forEach(listener => listener.notify());
};

export const subscribeToStreaming = (
  chatId: string,
  nodeId: string,
  callback: () => void,
  interval = 150,
  reasoning = false,
  firstOnly = false
): (() => void) => {
  const key = bufferKey(chatId, nodeId);
  let listeners = streamingListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    streamingListeners.set(key, listeners);
  }
  const read = () => {
    if (reasoning) return peekBufferedReasoning(chatId, nodeId);
    const first = peekBufferedContent(chatId, nodeId)?.[0];
    return first && isTextContent(first) ? first.text : undefined;
  };
  let published = read();
  let lastPublished = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const publish = () => {
    clear();
    if (typeof document !== 'undefined' && document.hidden) return;
    const next = read();
    if (next === published) return;
    published = next;
    lastPublished = Date.now();
    callback();
  };
  const notify = () => {
    if ((firstOnly && published) || timer || read() === published ||
        (typeof document !== 'undefined' && document.hidden)) return;
    const elapsed = Date.now() - lastPublished;
    if (elapsed >= interval) publish();
    else timer = setTimeout(publish, interval - elapsed);
  };
  const listener = { notify, clear };
  listeners.add(listener);
  const onVisibilityChange = () => {
    clear();
    lastPublished = -Infinity;
    if (!document.hidden) notify();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
    listeners!.delete(listener);
    if (!listeners!.size) streamingListeners.delete(key);
  };
};

export const finalizeStreamingSnapshotState = (
  chats: ChatInterface[] | undefined,
  contentStore: ContentStoreData
): {
  chats: ChatInterface[] | undefined;
  contentStore: ContentStoreData;
  changed: boolean;
} => {
  if (!chats || chats.length === 0) {
    return { chats, contentStore, changed: false };
  }

  let updatedChats = chats;
  let updatedContentStore = contentStore;
  let changed = false;
  const rematerializedChatIndexes = new Set<number>();

  chats.forEach((chat, chatIndex) => {
    const tree = chat.branchTree;
    if (!tree) return;

    Object.values(tree.nodes).forEach((node) => {
      if (!isStreamingContentHash(node.contentHash)) return;

      const bufferedContent = getBufferedContent(chat.id, node.id);
      if (!bufferedContent) return;

      if (!changed) {
        updatedChats = chats.slice();
        updatedContentStore = Object.fromEntries(Object.entries(contentStore).map(([hash, entry]) => [hash, { ...entry }]));
        changed = true;
      }

      if (updatedChats[chatIndex] === chats[chatIndex]) {
        updatedChats = cloneChatAt(updatedChats, chatIndex);
      }

      const updatedChat = updatedChats[chatIndex];
      const updatedTree = updatedChat.branchTree!;
      updatedTree.nodes[node.id] = {
        ...updatedTree.nodes[node.id],
        contentHash: addContent(updatedContentStore, bufferedContent),
      };
      rematerializedChatIndexes.add(chatIndex);
    });
  });

  rematerializedChatIndexes.forEach((chatIndex) => {
    const chat = updatedChats![chatIndex];
    if (!chat.branchTree) return;
    chat.messages = materializeActivePath(chat.branchTree, updatedContentStore);
  });

  return { chats: updatedChats, contentStore: updatedContentStore, changed };
};
