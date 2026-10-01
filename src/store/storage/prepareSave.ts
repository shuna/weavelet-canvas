import { isStreamingContentHash } from '@utils/streamingBuffer';
import type { ContentStoreData } from '@utils/contentStore';
import type { BranchClipboard, ChatInterface } from '@type/chat';
import type { PersistedChatData } from '@store/persistence';
type PersistedChat = Omit<ChatInterface, 'messages'> & { messages?: ChatInterface['messages'] };

export function findPersistedDataIntegrityErrors(
  chats: PersistedChat[],
  contentStore: ContentStoreData,
  clipboard: BranchClipboard | null,
  options: { allowTransientStreamingHashes?: boolean } = {}
): string[] {
  const errors: string[] = [];
  const seenChatIds = new Set<string>();

  const checkContentHash = (hash: unknown, owner: string) => {
    // A page can close between persisting a streaming placeholder and the
    // final buffered snapshot. Rehydration already replaces these known
    // transient references with recoverable empty content. Let that repair
    // run instead of classifying the whole committed snapshot as corrupt.
    if (
      options.allowTransientStreamingHashes &&
      typeof hash === 'string' &&
      isStreamingContentHash(hash)
    ) {
      return;
    }
    if (typeof hash !== 'string' || !contentStore[hash]) {
      errors.push(`Missing contentHash for ${owner}: ${String(hash)}`);
      return;
    }
    const visited = new Set<string>();
    let current = hash;
    while (contentStore[current]?.delta) {
      if (visited.has(current)) {
        errors.push(`Circular delta chain for ${owner}: ${hash}`);
        return;
      }
      visited.add(current);
      current = contentStore[current].delta!.baseHash;
      if (!contentStore[current]) {
        errors.push(`Missing delta base for ${owner}: ${current}`);
        return;
      }
    }
  };

  for (const chat of chats) {
    if (!chat || typeof chat.id !== 'string' || chat.id.length === 0) {
      errors.push('Chat has an invalid id');
      continue;
    }
    if (seenChatIds.has(chat.id)) {
      errors.push(`Duplicate chat id: ${chat.id}`);
    }
    seenChatIds.add(chat.id);

    if (!chat.branchTree) continue;
    if (
      !chat.branchTree.nodes ||
      typeof chat.branchTree.nodes !== 'object' ||
      Array.isArray(chat.branchTree.nodes)
    ) {
      errors.push(`Invalid branchTree nodes: ${chat.id}`);
      continue;
    }
    for (const node of Object.values(chat.branchTree.nodes)) {
      checkContentHash(node?.contentHash, `chat ${chat.id}`);
    }
  }

  if (
    clipboard &&
    (!clipboard.nodes ||
      typeof clipboard.nodes !== 'object' ||
      Array.isArray(clipboard.nodes))
  ) {
    errors.push('Invalid branch clipboard nodes');
  } else if (clipboard?.nodes) {
    for (const node of Object.values(clipboard.nodes)) {
      checkContentHash(node?.contentHash, 'branch clipboard');
    }
  }

  return errors;
}

export function computeChatFingerprint(chat: PersistedChat): string {
  // Use JSON.stringify to capture ALL persisted fields (title, config, folder,
  // imageDetail, collapsedNodes, branchTree, messages, etc.).
  // This ensures any field change triggers a differential write.
  return JSON.stringify(chat);
}

// The worker returns the exact captured data that was validated and fingerprinted.
export function prepareSave(data: PersistedChatData) {
  const chats = data.chats ?? [];
  const errors = findPersistedDataIntegrityErrors(chats, data.contentStore ?? {}, data.branchClipboard ?? null);
  const fingerprints = errors.length ? [] : chats.map(chat => [chat.id, computeChatFingerprint(chat)] as const);
  return { data, errors, fingerprints };
}
