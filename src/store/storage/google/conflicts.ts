import { create } from 'zustand';
import { toRecords, type Snapshot } from './records';

export type Resolution = 'merge' | 'local' | 'cloud';
export class SyncConflictError extends Error {
  constructor(readonly keys: string[]) { super('Concurrent edits conflict. Both copies are preserved.'); }
}
export const useSyncReview = create(() => ({
  conflict: false,
  chats: [] as string[],
  folders: [] as string[],
}));
export async function markSyncChanges(before: Snapshot, after: Snapshot) {
  const previous = await toRecords(before), next = await toRecords(after);
  const chats = new Set<string>(), folders = new Set<string>();
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[key] === next[key]) continue;
    const path = JSON.parse(key) as string[];
    if (path[0] === 'chats' && path[1]) chats.add(path[1]);
    if (path[0] === 'state' && path[1] === 'folders' && path[2]) folders.add(path[2]);
  }
  for (const chat of [...before.state.chats ?? [], ...after.state.chats ?? []]) {
    if (chat.folder && chats.has(chat.id)) folders.add(chat.folder);
  }
  useSyncReview.setState(state => ({ chats: [...new Set([...state.chats, ...chats])], folders: [...new Set([...state.folders, ...folders])] }));
}
