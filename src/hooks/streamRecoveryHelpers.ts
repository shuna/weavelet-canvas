import { showToast } from '@utils/showToast';

import type { ChatInterface, MessageInterface, TextContentInterface, ReasoningContentInterface } from '@type/chat';
import { isTextContent } from '@type/chat';
import type { StreamRecord } from '@utils/streamDb';

export type RecoveryStatus = Exclude<StreamRecord['status'], 'streaming'> | 'streaming-with-proxy';

const STREAM_STALE_THRESHOLD_MS = 30_000;

export const getCurrentMessageText = (message: MessageInterface | undefined): string => {
  const firstContent = message?.content[0];
  return isTextContent(firstContent) ? firstContent.text : '';
};

export const shouldApplyRecoveredText = (
  currentText: string,
  bufferedText: string,
  currentReasoning = '',
  bufferedReasoning = ''
): boolean => bufferedText.length > currentText.length || bufferedReasoning.length > currentReasoning.length;

export const buildRecoveredMessage = (
  message: MessageInterface,
  bufferedText: string,
  bufferedReasoning = ''
): MessageInterface => {
  const firstContent = message.content[0];
  const recoveredContent: TextContentInterface = isTextContent(firstContent)
    ? { ...firstContent, text: bufferedText }
    : { type: 'text', text: bufferedText };

  const existingReasoning = message.content.find((content): content is ReasoningContentInterface => content.type === 'reasoning');
  const reasoning = bufferedReasoning
    ? { type: 'reasoning' as const, text: bufferedReasoning }
    : existingReasoning;
  return {
    ...message,
    content: [recoveredContent, ...(reasoning ? [reasoning] : []), ...message.content.slice(1).filter((content) => content.type !== 'reasoning')],
  };
};

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

export const findRecoverableChat = (
  chats: ChatInterface[] | undefined,
  chatIndex: number
): ChatInterface | null => {
  if (!chats || chatIndex < 0 || chatIndex >= chats.length) return null;
  return chats[chatIndex];
};

export const hasRecoverableMessage = (
  chat: ChatInterface,
  messageIndex: number
): boolean => messageIndex >= 0 && messageIndex < chat.messages.length;

const RECOVERY_TOASTS: Record<
  RecoveryStatus,
  { message: string; status: 'info' | 'warning'; duration: number }
> = {
  completed: {
    message: 'バックグラウンド中に応答が完了しました',
    status: 'info',
    duration: 4000,
  },
  interrupted: {
    message: 'バックグラウンド中に応答が途切れました',
    status: 'warning',
    duration: 6000,
  },
  failed: {
    message: 'バックグラウンド中に応答が途切れました',
    status: 'warning',
    duration: 6000,
  },
  'streaming-with-proxy': {
    message: 'プロキシ経由でストリームを復元中…',
    status: 'info',
    duration: 4000,
  },
};

export const showRecoveryToast = (status: RecoveryStatus) => {
  const entry = RECOVERY_TOASTS[status];
  showToast(entry.message, entry.status, entry.duration);
};
