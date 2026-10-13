import { grepChats, matchesChatHistoryFilter } from '../../src/utils/chatSearch';
import { searchBranchNodes } from '../../src/utils/branchSearch';
import type { ChatInterface, FolderCollection } from '../../src/types/chat';
import type { ContentStoreData } from '../../src/utils/contentStore';

type Input = { chats: ChatInterface[]; folders: FolderCollection; contentStore: ContentStoreData; query: string;
  mode: 'library' | 'grep' | 'nodes'; scope?: 'all' | 'activePath'; starredOnly?: boolean; chatID?: string; currentChatID?: string; currentPath?: string[] };
function resultsJSON(results: unknown[]): string {
  // Web's UTF-16 snippet slices can split an emoji. Native JSON string decoding
  // needs the replacement glyph that the Web UI displays for an isolated unit.
  return JSON.stringify(results, (key, value) => key === 'snippet' && typeof value === 'string'
    ? value.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g, (_unit, pair) => pair ?? '\uFFFD') : value);
}
export function chatSearch(json: string): string {
  const input = JSON.parse(json) as Input;
  if (input.currentPath) input.chats = input.chats.map(chat => chat.id === input.currentChatID && chat.branchTree
    ? {...chat,branchTree:{...chat.branchTree,activePath:input.currentPath!}} : chat);
  const indexed = input.chats.map((chat, index) => ({ chat, index })).filter(({ chat }) => !input.chatID || chat.id === input.chatID);
  if (input.mode === 'library') {
    return resultsJSON(indexed.filter(({ chat }) => matchesChatHistoryFilter(input.query, chat, input.folders, input.currentChatID))
      .map(({ chat, index }) => ({ chatId: chat.id, nodeId: null, resultId: chat.id, chatIndex: index, chatTitle: chat.title,
        snippet: chat.title, matchType: 'title', isOnActivePath: true })));
  }
  if (input.mode === 'grep') {
    const groups = grepChats(input.chats, input.contentStore, input.query);
    return resultsJSON(groups.filter(group => !input.chatID || group.chatId === input.chatID).flatMap(group =>
      group.matches.map(match => ({ ...match, resultId: match.nodeId, nodeId: match.nodeId.startsWith('legacy-') && !input.chats[match.chatIndex].branchTree ? null : match.nodeId, chatTitle: group.chatTitle }))));
  }
  if (input.mode !== 'nodes') throw new Error('Unknown search mode.');
  const entries = indexed.filter(({ chat }) => chat.branchTree).map(({ chat, index }) => ({ tree: chat.branchTree!, chatId: chat.id, chatIndex: index }));
  return resultsJSON(searchBranchNodes(input.query, entries, input.contentStore, input.scope ?? 'all', { starredOnly: input.starredOnly })
    .map(match => ({ ...match, resultId: match.nodeId, chatTitle: input.chats[match.chatIndex].title })));
}
