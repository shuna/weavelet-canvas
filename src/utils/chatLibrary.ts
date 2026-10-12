import type { ChatInterface, ConfigInterface, ImageDetail } from '@type/chat';
import { cloneChatAtIndex, deepCloneSingleChat } from './chatShallowClone';
import { releaseContent, retainContent, type ContentStoreData } from './contentStore';
import { isStreamingContentHash } from './streamingBuffer';

export function createLibraryChat(id: string, title: string | undefined, config: ConfigInterface, imageDetail: ImageDetail, systemPrompt?: string, folder?: string): ChatInterface {
  return {
    id,
    title: title ? title : 'New Chat',
    messages: [],
    config: {
      ...structuredClone(config),
      reasoning_effort: config.reasoning_effort ?? 'none',
      reasoning_budget_tokens: config.reasoning_budget_tokens ?? 0,
      systemPrompt: systemPrompt || undefined,
    },
    titleSet: false,
    folder,
    imageDetail,
  };
}

export function addLibraryChat(chats: ChatInterface[], create: (title: string) => ChatInterface): ChatInterface[] {
  let index = 1;
  while (chats.some(chat => chat.title === `New Chat ${index}`)) index++;
  return [create(`New Chat ${index}`), ...chats];
}

export function renameLibraryChat(chats: ChatInterface[], index: number, title: string): ChatInterface[] {
  const updated = cloneChatAtIndex(chats, index);
  updated[index].title = title;
  return updated;
}

// Reference updates and delta promotion must not mutate the currently displayed snapshot.
const copyEntries = (store: ContentStoreData): ContentStoreData =>
  Object.fromEntries(Object.entries(store).map(([hash, entry]) => [hash, { ...entry }]));

export function duplicateLibraryChat(chats: ChatInterface[], index: number, store: ContentStoreData, newID?: string) {
  const original = chats[index];
  let title = `Copy of ${original.title}`, suffix = 0;
  while (chats.some(chat => chat.title === title)) title = `Copy ${++suffix} of ${original.title}`;
  const chat = deepCloneSingleChat(original, newID);
  chat.title = title;
  const contentStore = copyEntries(store);
  for (const node of Object.values(chat.branchTree?.nodes ?? {})) retainContent(contentStore, node.contentHash);
  return { chats: [chat, ...chats], contentStore };
}

export function deleteLibraryChats(chats: ChatInterface[], indices: number[], store: ContentStoreData, create: () => ChatInterface) {
  const selected = new Set(indices);
  const remaining = chats.filter((_, index) => !selected.has(index));
  if (remaining.length) {
    const removed = new Map<string, number>();
    for (const [index, chat] of chats.entries()) {
      if (!selected.has(index)) continue;
      for (const node of Object.values(chat.branchTree?.nodes ?? {})) {
        if (isStreamingContentHash(node.contentHash)) continue;
        removed.set(node.contentHash, (removed.get(node.contentHash) ?? 0) + 1);
      }
    }
    for (const [hash, count] of removed) {
      if (!store[hash] || !Number.isInteger(store[hash].refCount) || store[hash].refCount < count) {
        throw new Error('Invalid message reference count; conversation was not deleted.');
      }
    }
  }
  const contentStore = copyEntries(store);
  for (const [index, chat] of chats.entries()) {
    if (!selected.has(index)) continue;
    for (const node of Object.values(chat.branchTree?.nodes ?? {})) releaseContent(contentStore, node.contentHash);
  }
  if (!remaining.length) return { chats: [create()], contentStore: {} as ContentStoreData };
  return { chats: remaining, contentStore };
}
