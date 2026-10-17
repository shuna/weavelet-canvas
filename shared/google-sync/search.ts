import { grepChats, matchesChatHistoryFilter } from '../../src/utils/chatSearch';
import { searchBranchNodes } from '../../src/utils/branchSearch';
import type { ChatInterface, FolderCollection } from '../../src/types/chat';
import type { ContentStoreData } from '../../src/utils/contentStore';
import { reconcileSearchResults, saveSearchHistory, stepSearchResult, type SearchIdentity } from '../../src/utils/searchState';

type SearchStateInput =
  | { operation: 'history'; history: string[]; query: string }
  | { operation: 'reconcile'; previous: SearchIdentity[]; index: number; results: SearchIdentity[] }
  | { operation: 'step'; index: number; count: number; backward: boolean };

export function searchStateOperation(json: string): string {
  const input = JSON.parse(json) as SearchStateInput;
  switch (input.operation) {
    case 'history': return JSON.stringify(saveSearchHistory(input.history, input.query));
    case 'reconcile': return JSON.stringify(reconcileSearchResults(input.previous, input.index, input.results));
    case 'step': return JSON.stringify(stepSearchResult(input.index, input.count, input.backward));
    default: throw new Error('Unknown search state operation.');
  }
}

type Input = { chats: ChatInterface[]; folders: FolderCollection; contentStore: ContentStoreData; query: string;
  mode: 'library' | 'grep' | 'nodes'; scope?: 'all' | 'activePath'; starredOnly?: boolean; chatID?: string; chatIDs?: string[]; currentChatID?: string; currentPath?: string[] };
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
  const byID = new Map(indexed.map(entry => [entry.chat.id, entry]));
  // BranchEditorCanvas preserves the displayed chatIndices order, not store order.
  const displayed = input.chatIDs === undefined ? indexed : input.chatIDs.flatMap(id => {
    const entry = byID.get(id);
    return entry ? [entry] : [];
  });
  const entries = displayed.filter(({ chat }) => chat.branchTree)
    .map(({ chat, index }) => ({ tree: chat.branchTree!, chatId: chat.id, chatIndex: index }));
  return resultsJSON(searchBranchNodes(input.query, entries, input.contentStore, input.scope ?? 'all', { starredOnly: input.starredOnly })
    .map(match => ({ ...match, resultId: match.nodeId, chatTitle: input.chats[match.chatIndex].title })));
}
