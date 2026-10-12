import type { Records, Snapshot } from './records';
import { toRecordsAsync } from './processing';

export interface SyncOverview { chats: number; messages: number; bytes: number }
export interface CloudSyncOverview extends SyncOverview { versions: number }
export interface CloudSyncReview {
  snapshot: Snapshot;
  versions: { id: string; snapshot: Snapshot }[];
}

export function summarizeSyncRecords(snapshot: Snapshot, records: Records): SyncOverview {
  const chats = snapshot.state.chats ?? [];
  return {
    chats: chats.length,
    messages: chats.reduce((count, chat) => count + (chat.branchTree ? Object.keys(chat.branchTree.nodes).length : chat.messages?.length ?? 0), 0),
    bytes: new TextEncoder().encode(JSON.stringify(records)).length,
  };
}

export async function summarizeSyncSnapshot(snapshot: Snapshot): Promise<SyncOverview> {
  return summarizeSyncRecords(snapshot, await toRecordsAsync(snapshot));
}
