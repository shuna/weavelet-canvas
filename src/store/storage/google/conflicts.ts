import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Snapshot } from './records';
import { toRecordsAsync as toRecords } from './processing';
export { SyncConflictError } from './records';

export type Resolution = 'merge' | 'local' | 'cloud';
export const useSyncReview = create(persist(() => ({
  conflict: false,
  chats: [] as string[],
  folders: [] as string[],
  nodes: {} as Record<string, string[]>,
}), { name: 'weavelet-sync-review', partialize: ({ chats, folders, nodes }) => ({ chats, folders, nodes }) }));

export function acknowledgeSyncChat(chatId: string) {
  useSyncReview.setState(state => ({ chats: state.chats.filter(id => id !== chatId), nodes: { ...state.nodes, [chatId]: [] } }));
}
export function acknowledgeSyncNode(chatId: string, nodeId: string) {
  useSyncReview.setState(state => ({ nodes: { ...state.nodes, [chatId]: (state.nodes[chatId] ?? []).filter(id => id !== nodeId) } }));
}
export async function markSyncChanges(before: Snapshot, after: Snapshot) {
  const previous = await toRecords(before), next = await toRecords(after);
  const chats = new Set<string>(), folders = new Set<string>();
  const changedNodes = new Map<string, Set<string>>();
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[key] === next[key]) continue;
    const path = JSON.parse(key) as string[];
    if (path[0] === 'chats' && path[1]) chats.add(path[1]);
    if (path[0] === 'chats' && path[2] === 'branchTree' && path[3] === 'nodes' && path[4]) {
      if (!changedNodes.has(path[1])) changedNodes.set(path[1], new Set());
      changedNodes.get(path[1])!.add(path[4]);
    }
    if (path[0] === 'state' && path[1] === 'folders' && path[2]) folders.add(path[2]);
  }
  const nodes: Record<string, string[]> = {};
  for (const chat of after.state.chats ?? []) {
    const changed = changedNodes.get(chat.id);
    if (!changed) continue;
    if (changed.size) nodes[chat.id] = [...changed];
  }
  for (const chat of [...before.state.chats ?? [], ...after.state.chats ?? []]) {
    if (chat.folder && chats.has(chat.id)) folders.add(chat.folder);
  }
  useSyncReview.setState(state => ({
    chats: [...new Set([...state.chats, ...chats])], folders: [...new Set([...state.folders, ...folders])],
    nodes: { ...state.nodes, ...Object.fromEntries(Object.entries(nodes).map(([id, changed]) => [id, [...new Set([...state.nodes[id] ?? [], ...changed])]])) },
  }));
}
