import { useEffect, useRef } from 'react';
import useStore from '@store/store';
import { getAllPending, deleteRequest, StreamRecord } from '@utils/streamDb';
import { upsertActivePathMessage } from '@utils/branchUtils';
import { cloneChatAtIndex } from '@utils/chatShallowClone';
import { register } from '@utils/swBridge';
import {
  buildRecoveredMessage,
  findRecoverableChat,
  getCurrentMessageText,
  hasRecoverableMessage,
  resolveRecoveryStatus,
  shouldApplyRecoveredText,
  showRecoveryToast,
} from './streamRecoveryHelpers';

const VISIBILITY_THRESHOLD_MS = 3000;

export default function useStreamRecovery() {
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Register SW on mount
    register();
    // Recover any pending records from a previous session (cold start)
    recoverPending();
  }, []);

  useEffect(() => {
    const onPageShow = () => {
      if (hiddenAtRef.current) {
        hiddenAtRef.current = null;
        recoverPending();
      }
    };

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }

      // Foreground
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;

      // Suppress for short background durations
      if (hiddenAt && Date.now() - hiddenAt < VISIBILITY_THRESHOLD_MS) return;

      recoverPending();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}

async function recoverPending() {
  let records: StreamRecord[];
  try {
    records = await getAllPending();
  } catch {
    return;
  }

  if (records.length === 0) return;

  const { setChats } = useStore.getState();

  for (const record of records) {
    const { requestId, chatIndex, messageIndex, bufferedText, status } = record;

    // Re-read latest state each iteration to avoid overwriting prior recoveries
    const chats = useStore.getState().chats;
    if (!chats) return;

    const chat = findRecoverableChat(chats, chatIndex);
    if (!chat) {
      await deleteRequest(requestId);
      continue;
    }
    if (!hasRecoverableMessage(chat, messageIndex)) {
      await deleteRequest(requestId);
      continue;
    }

    const currentText = getCurrentMessageText(chat.messages[messageIndex]);

    // Only apply if SW captured more text than what's currently displayed
    if (shouldApplyRecoveredText(currentText, bufferedText)) {
      const updatedChats = cloneChatAtIndex(chats, chatIndex);
      const updatedMessages = updatedChats[chatIndex].messages;
      const oldMsg = updatedMessages[messageIndex];
      const newMsg = buildRecoveredMessage(oldMsg, bufferedText);
      updatedMessages[messageIndex] = newMsg;
      upsertActivePathMessage(
        updatedChats[chatIndex],
        messageIndex,
        newMsg,
        useStore.getState().contentStore
      );
      setChats(updatedChats);
    }

    // Determine if stream is stale (SW probably died)
    const effectiveStatus = resolveRecoveryStatus(record);
    if (effectiveStatus === 'streaming') {
      // Still actively streaming, don't notify yet
      continue;
    }

    // Clear any generating sessions for this chat
    useStore.getState().removeSessionsForChat(
      useStore.getState().chats?.[chatIndex]?.id ?? ''
    );

    // Show toast
    showRecoveryToast(effectiveStatus);

    await deleteRequest(requestId);
  }
}
