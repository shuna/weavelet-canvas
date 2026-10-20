import type { ChatInterface } from '@type/chat';
import type { NavEntry, NavigationSlice } from '@store/navigation-slice';
import { buildPathToLeaf } from './branchUtils';

type History = Pick<NavigationSlice,'navHistoryPast'|'navHistoryCurrent'|'navHistoryFuture'|'navEntryMap'>;
export type NavigationSource = NavEntry['source'];
export function resolveNavigationTarget(chats: ChatInterface[] | null | undefined, chatId: string, nodeId?: string, source: NavigationSource = 'branch-switch') {
  const chatIndex = chats?.findIndex(chat => chat.id === chatId) ?? -1;
  const chat = chats?.[chatIndex];
  if (!chat) return {status:'chat-missing' as const};
  if (nodeId && !chat.branchTree?.nodes[nodeId]) return {status:'node-missing' as const};
  const tree = chat.branchTree;
  const preservePath = (source === 'search' || source === 'grep') && nodeId && tree?.activePath.includes(nodeId);
  const path = nodeId && tree && !preservePath ? buildPathToLeaf(tree,nodeId) : [...(tree?.activePath ?? [])];
  return {status:'reached' as const,chatIndex,chatId,path,focusedNodeId:nodeId};
}
export function navigationEntry(target: {chatId:string;path:string[];focusedNodeId?:string}, viewContext: NavEntry['viewContext'], source: NavigationSource): Omit<NavEntry,'key'> {
  return {chatId:target.chatId,activePath:target.path,focusedNodeId:target.focusedNodeId,viewContext,source};
}
export function viewSwitchNavigationEntry(current: Pick<NavEntry,'chatId'|'viewContext'> | null, chat: Pick<ChatInterface,'id'|'branchTree'> | undefined, viewContext: NavEntry['viewContext']): Omit<NavEntry,'key'> | undefined {
  if (!chat || (current?.chatId === chat.id && current.viewContext === viewContext)) return;
  return {chatId:chat.id,activePath:[...(chat.branchTree?.activePath ?? [])],viewContext,source:'view-switch'};
}
export function entryWithNavigationKey(entry: Omit<NavEntry,'key'>, key: string): NavEntry { return {...entry,key}; }
export function navigationEntryWithAnchor(entry: NavEntry, anchor: NavEntry['scrollAnchor']): NavEntry {
  return anchor ? {...entry,scrollAnchor:{...anchor}} : entry;
}
export function captureNavigationHistory(history: History, entry: NavEntry | null): History {
  return {navHistoryPast:history.navHistoryPast,navHistoryCurrent:entry,navHistoryFuture:history.navHistoryFuture,navEntryMap:history.navEntryMap};
}
export function restoredNavigationPath(chat: ChatInterface, path: string[]): string[] | undefined {
  const tree = chat.branchTree;
  if (!tree) return;
  const valid = path.length > 0 && path.every((id,index) => tree.nodes[id]?.parentId === (index === 0 ? null : path[index-1]));
  return valid ? [...path] : undefined;
}
export const emptyNavigationHistory = (): History => ({navHistoryPast:[],navHistoryCurrent:null,navHistoryFuture:[],navEntryMap:new Map()});
export function initializeNavigationHistory(history: History, chat: ChatInterface | undefined, key: string, viewContext: NavEntry['viewContext']): History {
  if (history.navHistoryCurrent || !chat) return history;
  const entry: NavEntry = {key,chatId:chat.id,activePath:[...(chat.branchTree?.activePath ?? [])],viewContext,source:'init'};
  const navEntryMap = new Map(history.navEntryMap); navEntryMap.set(key,entry);
  return {navHistoryPast:history.navHistoryPast,navHistoryFuture:history.navHistoryFuture,navHistoryCurrent:entry,navEntryMap};
}
export function pushNavigationHistory(history: History, entry: NavEntry): History {
  const navHistoryPast = [...history.navHistoryPast];
  if (history.navHistoryCurrent) { navHistoryPast.push(history.navHistoryCurrent); if (navHistoryPast.length > 100) navHistoryPast.shift(); }
  const navEntryMap = new Map(history.navEntryMap); navEntryMap.set(entry.key,entry);
  return {navHistoryPast,navHistoryCurrent:entry,navHistoryFuture:[],navEntryMap};
}
export function moveNavigationHistory(history: History, chats: Array<{id:string}> | null | undefined, direction: 'back'|'forward'): History | undefined {
  const valid = (entry: NavEntry) => !!chats?.some(chat => chat.id === entry.chatId);
  const current = history.navHistoryCurrent;
  if (!current) return;
  if (direction === 'back') {
    const past = history.navHistoryPast, index = past.map(valid).lastIndexOf(true);
    if (index < 0) return;
    return {navEntryMap:history.navEntryMap,navHistoryPast:past.slice(0,index),navHistoryCurrent:past[index],navHistoryFuture:[...past.slice(index+1),current,...history.navHistoryFuture]};
  }
  const future = history.navHistoryFuture, index = future.findIndex(valid);
  if (index < 0) return;
  return {navEntryMap:history.navEntryMap,navHistoryPast:[...history.navHistoryPast,current,...future.slice(0,index)],navHistoryCurrent:future[index],navHistoryFuture:future.slice(index+1)};
}
export function canMoveNavigationHistory(history: History, chats: Array<{id:string}> | null | undefined, direction:'back'|'forward') {
  return (direction === 'back' ? history.navHistoryPast : history.navHistoryFuture).some(entry => chats?.some(chat => chat.id === entry.chatId));
}
