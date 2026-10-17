import { v4 as uuidv4 } from 'uuid';
import { ChatInterface } from '@type/chat';

/**
 * Shallow-clone the chats array, replacing only chats[chatIndex]
 * with a shallow copy. Messages array is shallow-copied so splice/push
 * won't mutate the original. Config is shallow-copied for property updates.
 * BranchTree and collapsedNodes are preserved by reference (not touched).
 * All other chats keep their original references → structural sharing.
 */
export const cloneChatAtIndex = (
  chats: ChatInterface[],
  chatIndex: number
): ChatInterface[] => {
  const result = chats.slice();
  const chat = result[chatIndex];
  result[chatIndex] = {
    ...chat,
    messages: chat.messages.slice(),
    config: { ...chat.config },
  };
  return result;
};

/**
 * Deep-clone a single chat for duplication (clone chat).
 * Uses structuredClone for correctness without full-array deep clone.
 */
export const deepCloneSingleChat = (chat: ChatInterface): ChatInterface => {
  const clone = { ...structuredClone(chat), id: uuidv4() };
  // Recovery records belong to the original chat and node IDs.
  for (const node of Object.values(clone.branchTree?.nodes ?? {})) delete node.streamState;
  return clone;
};
