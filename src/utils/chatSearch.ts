import type { ChatInterface, FolderCollection } from '@type/chat';
import { isTextContent } from '@type/chat';
import { searchBranchNodes, type SearchResult } from './branchSearch';
import type { ContentStoreData } from './contentStore';
import { getFolderAncestors } from './folderHierarchy';

export function matchesChatHistoryFilter(query: string, chat: ChatInterface, folders: FolderCollection, currentChatId?: string): boolean {
  const lower = query.toLowerCase();
  const folder = chat.folder ? folders[chat.folder] : undefined;
  const folderName = folder ? getFolderAncestors(folders, folder.id).map(id => folders[id].name.toLowerCase()).join(' ') : '';
  return chat.title.toLowerCase().includes(lower) || folderName.includes(lower) || chat.id === currentChatId;
}

/**
 * Fallback search for legacy chats without branchTree.
 * Searches message text content directly.
 */
export function searchLegacyChat(
  chat: ChatInterface,
  chatIndex: number,
  query: string
): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  for (let i = 0; i < chat.messages.length; i++) {
    const msg = chat.messages[i];
    const textParts = msg.content
      .filter(isTextContent)
      .map((c) => c.text);
    const fullText = textParts.join(' ');
    const lowerText = fullText.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx < 0) continue;

    const start = Math.max(0, idx - 40);
    const end = Math.min(fullText.length, idx + query.length + 40);
    let snippet = '';
    if (start > 0) snippet += '...';
    snippet += fullText.slice(start, end);
    if (end < fullText.length) snippet += '...';

    results.push({
      nodeId: `legacy-${i}`,
      chatId: chat.id,
      chatIndex,
      snippet,
      isOnActivePath: true,
      matchType: 'content',
    });
  }

  return results;
}

export function grepChats(chats: readonly ChatInterface[], contentStore: ContentStoreData, query: string) {
  const normalized = query.trim();
  if (!normalized) return [];
  return chats.flatMap((chat, chatIndex) => {
    const matches = chat.branchTree ? searchBranchNodes(normalized, [{ tree: chat.branchTree, chatId: chat.id, chatIndex }], contentStore, 'all')
      : searchLegacyChat(chat, chatIndex, normalized);
    return matches.length ? [{ chatId: chat.id, chatIndex, chatTitle: chat.title, matches }] : [];
  });
}
