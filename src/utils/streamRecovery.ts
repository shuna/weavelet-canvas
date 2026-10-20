import type { ChatInterface } from '@type/chat';
import { resolveContent, type ContentStoreData } from '@utils/contentStore';
import type { StreamRecord } from '@utils/streamDb';

const STREAM_STALE_THRESHOLD_MS = 30_000;

export const resolveRecoveryStatus = (
  record: StreamRecord,
  now: number = Date.now(),
  hasActiveSession?: boolean
): StreamRecord['status'] | 'streaming-with-proxy' => {
  if (record.status !== 'streaming') return record.status;
  // Active session check takes priority — never interfere with live streams
  if (hasActiveSession === true) return 'streaming';
  // If this record no longer has a live generating session, it is orphaned
  // and should be recovered immediately instead of waiting for staleness.
  if (hasActiveSession === false) {
    if (record.proxySessionId) return 'streaming-with-proxy';
    return 'interrupted';
  }
  // hasActiveSession is undefined (legacy) — use staleness heuristic
  if (record.proxySessionId) return 'streaming-with-proxy';
  return now - record.updatedAt > STREAM_STALE_THRESHOLD_MS
    ? 'interrupted'
    : 'streaming';
};

/** Missing IDs/checkpoints remain recovery data, never an index-based write target. */
export const resolveRecoveryTarget = (chats: ChatInterface[] | undefined, contentStore: ContentStoreData, record: StreamRecord, expectedHash?: string) => {
  if (!record.chatId || !record.nodeId || !record.checkpointRole) return null;
  const chatIndex = chats?.findIndex(chat => chat.id === record.chatId) ?? -1;
  const chat = chats?.[chatIndex];
  const node = chat?.branchTree?.nodes[record.nodeId];
  if (!chat || !node || node.role !== record.checkpointRole) return null;
  if (node.streamState?.requestId && node.streamState.requestId !== record.requestId) return null;
  const matchesHash = expectedHash !== undefined
    ? node.contentHash === expectedHash
    : node.contentHash === record.checkpointHash || node.contentHash === record.appliedHash;
  if (!matchesHash) return null;
  return { chat, chatIndex, node, messageIndex: chat.branchTree!.activePath.indexOf(record.nodeId), message: { role: node.role, content: resolveContent(contentStore, node.contentHash) } };
};
