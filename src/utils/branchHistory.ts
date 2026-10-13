import type { ChatInterface } from '../types/chat';
import type { ContentStoreData } from './contentStore';
import { materializeActivePath } from './branchUtils';
export interface BranchChatSnapshot {
  id: string;
  messages: ChatInterface['messages'];
  branchTree: ChatInterface['branchTree'];
  expectedActivePath?: string[];
  systemPrompt?: { value: string | undefined };
}

export interface BranchSnapshot {
  chats: BranchChatSnapshot[];
  contentStore: ContentStoreData;
}

const HISTORY_LIMIT = 50;

export const changedBranchChatIds = (
  previous: ChatInterface[],
  next: ChatInterface[],
  sameBranch = (a: ChatInterface, b: ChatInterface) => a.messages === b.messages && a.branchTree === b.branchTree
) => {
  const nextById = new Map(next.map((chat) => [chat.id, chat]));
  const previousById = new Map(previous.map((chat) => [chat.id, chat]));
  const ids = new Set<string>();
  for (const chat of previous) {
    const updated = nextById.get(chat.id);
    if (!updated || !sameBranch(chat, updated)) {
      ids.add(chat.id);
    }
  }
  for (const chat of next) {
    if (!previousById.has(chat.id)) ids.add(chat.id);
  }
  return [...ids];
};

const snapshotContentStore = (
  chats: BranchChatSnapshot[],
  contentStore: ContentStoreData
) => {
  const snapshot: ContentStoreData = {};
  const add = (hash: string) => {
    const entry = contentStore[hash];
    if (snapshot[hash] || !entry) return;
    snapshot[hash] = structuredClone(entry);
    if (entry.delta) add(entry.delta.baseHash);
  };
  for (const chat of chats) {
    Object.values(chat.branchTree?.nodes ?? {}).forEach((node) => add(node.contentHash));
  }
  return snapshot;
};

export const createBranchSnapshot = (
  chats: ChatInterface[],
  contentStore: ContentStoreData,
  chatIds: string[],
  expectedChats: ChatInterface[] = chats
): BranchSnapshot => {
  const ids = new Set(chatIds);
  const expectedById = new Map(expectedChats.map((chat) => [chat.id, chat]));
  const snapshotChats = chats
    .filter((chat) => ids.has(chat.id))
    .map((chat) => ({
      id: chat.id,
      messages: structuredClone(chat.messages),
      branchTree: structuredClone(chat.branchTree),
      expectedActivePath: expectedById.get(chat.id)?.branchTree?.activePath.slice(),
      ...(chat.config.systemPrompt !== expectedById.get(chat.id)?.config.systemPrompt
        ? { systemPrompt: { value: chat.config.systemPrompt } }
        : {}),
    }));
  return {
    chats: snapshotChats,
    contentStore: snapshotContentStore(snapshotChats, contentStore),
  };
};

const isUsableActivePath = (
  tree: NonNullable<ChatInterface['branchTree']>,
  path: string[]
) => path.length > 0 && path.every((id, index) => {
  const node = tree.nodes[id];
  return !!node && (index === 0 ? node.parentId === null : node.parentId === path[index - 1]);
});

const pathsEqual = (first: string[], second: string[]) =>
  first.length === second.length && first.every((id, index) => id === second[index]);

export const restoreBranchSnapshot = (
  chats: ChatInterface[],
  contentStore: ContentStoreData,
  snapshot: BranchSnapshot
) => {
  const snapshots = new Map(snapshot.chats.map((chat) => [chat.id, chat]));
  const restored = chats.map((chat) => {
    const saved = snapshots.get(chat.id);
    if (!saved) return chat;
    const config = saved.systemPrompt
      ? { ...chat.config, systemPrompt: saved.systemPrompt.value }
      : chat.config;
    if (!saved.branchTree) return { ...chat, config, messages: structuredClone(saved.messages), branchTree: undefined };
    const branchTree = structuredClone(saved.branchTree);
    const currentPath = chat.branchTree?.activePath;
    if (currentPath && saved.expectedActivePath &&
      !pathsEqual(currentPath, saved.expectedActivePath) &&
      isUsableActivePath(branchTree, currentPath)) {
      branchTree.activePath = currentPath.slice();
    }
    return { ...chat, config, branchTree, messages: materializeActivePath(branchTree, contentStore) };
  });
  return restored;
};


export interface BranchHistory { past: BranchSnapshot[]; future: BranchSnapshot[] }
export interface BranchHistoryState { chats: ChatInterface[]; contentStore: ContentStoreData }
export type BranchEditCapture = (before: BranchHistoryState, after: BranchHistoryState) => void;
export const captureBranchHistory = (history: BranchHistory, before: BranchHistoryState, after: BranchHistoryState): BranchHistory => {
  const ids = changedBranchChatIds(before.chats, after.chats);
  return ids.length ? {past: [...history.past, createBranchSnapshot(before.chats, before.contentStore, ids, after.chats)].slice(-HISTORY_LIMIT), future: []} : history;
};
export const invalidateBranchHistory = (history: BranchHistory, chatIds: string[]): BranchHistory => {
  const ids = new Set(chatIds);
  const keep = (snapshot: BranchSnapshot) => !snapshot.chats.some(chat => ids.has(chat.id));
  return {past: history.past.filter(keep), future: history.future.filter(keep)};
};
export const canStepBranchHistory = (history: BranchHistory, direction: 'undo'|'redo', busyChatIds: string[]) => {
  const snapshot = (direction === 'undo' ? history.past : history.future).at(-1);
  return !!snapshot && !snapshot.chats.some(chat => busyChatIds.includes(chat.id));
};
export const stepBranchHistory = (history: BranchHistory, state: BranchHistoryState, direction: 'undo'|'redo', busyChatIds: string[]) => {
  const snapshot = (direction === 'undo' ? history.past : history.future).at(-1);
  const affectedChatIds = snapshot?.chats.map(chat => chat.id) ?? [];
  if (!snapshot) return {status: 'empty' as const, history, state, affectedChatIds};
  if (affectedChatIds.some(id => !state.chats.some(chat => chat.id === id))) return {status: 'chat-missing' as const, history, state, affectedChatIds};
  if (!canStepBranchHistory(history, direction, busyChatIds)) return {status: 'busy' as const, history, state, affectedChatIds};
  const current = createBranchSnapshot(state.chats, state.contentStore, affectedChatIds, restoreBranchSnapshot(state.chats, state.contentStore, snapshot));
  const contentStore = {...snapshot.contentStore, ...state.contentStore};
  return {status: 'updated' as const, affectedChatIds,
    state: {chats: restoreBranchSnapshot(state.chats, contentStore, snapshot), contentStore},
    history: direction === 'undo' ? {past: history.past.slice(0,-1), future: [...history.future,current]} : {past: [...history.past,current], future: history.future.slice(0,-1)}};
};
