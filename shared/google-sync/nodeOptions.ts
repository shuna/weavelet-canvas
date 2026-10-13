import type { BranchEditCapture, BranchHistoryState } from '../../src/utils/branchHistory';
import { resolveNodeTarget, setNodeDisplayFieldState } from '../../src/store/branch-domain';
import { setChatNodeMapState } from '../../src/utils/nodeOptions';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { materializeActivePath } from '../../src/utils/branchUtils';
import { withEditingRuntime } from './editing';
import type { ChatInterface } from '../../src/types/chat';
import type { ContentStoreData } from '../../src/utils/contentStore';

type Value = { label: string; starred: boolean; pinned: boolean; collapsed: boolean; omitted: boolean; protected: boolean };
type Input = { chat: ChatInterface; contentStore: ContentStoreData; operation: 'read' | 'save'; nodeId: string; value?: Value; newIDs?: string[]; now?: number };
export function nodeOptions(json: string, capture?: BranchEditCapture): string {
  const input = JSON.parse(json) as Input;
  const target = resolveNodeTarget([input.chat], { chatId: input.chat.id, nodeId: input.nodeId });
  if (target.status !== 'valid') return JSON.stringify({ status: target.status, changes: [] });
  const node = target.chat.branchTree?.nodes[input.nodeId];
  const value: Value = { label: node?.label ?? '', starred: !!node?.starred, pinned: !!node?.pinned,
    collapsed: !!target.chat.collapsedNodes?.[input.nodeId], omitted: !!target.chat.omittedNodes?.[input.nodeId], protected: !!target.chat.protectedNodes?.[input.nodeId] };
  if (input.operation === 'read') return JSON.stringify({ status: 'read', nodeId: input.nodeId, value });
  if (input.operation !== 'save' || !input.value || typeof input.value.label !== 'string' ||
      ['starred', 'pinned', 'collapsed', 'omitted', 'protected'].some(field => typeof input.value![field as keyof Value] !== 'boolean')) throw new Error('Invalid node options.');
  const before = { chat: input.chat, contentStore: input.contentStore };
  let { chat, contentStore } = structuredClone(before), nodeId = input.nodeId;
  return withEditingRuntime(input.newIDs ?? [], Object.keys(chat.branchTree?.nodes ?? {}), input.now ?? Date.now(), () => {
    let historyBase: BranchHistoryState | undefined;
    for (const field of ['label', 'starred', 'pinned'] as const) {
      if (input.value![field] === value[field]) continue;
      const next = input.value![field] || undefined;
      const result = setNodeDisplayFieldState([chat], { chatId: chat.id, nodeId }, field, next, contentStore);
      if (result.status === 'updated') { historyBase ??= result.historyBase; chat = result.chats[0]; contentStore = result.contentStore; nodeId = result.nodeId; }
    }
    for (const [field, option] of [['collapsedNodes', 'collapsed'], ['omittedNodes', 'omitted'], ['protectedNodes', 'protected']] as const) {
      if (input.value![option] === value[option]) continue;
      const result = setChatNodeMapState([chat], { chatId: chat.id, nodeId, value: input.value![option] }, field);
      if (result.status === 'updated') chat = result.chats[0];
    }
    if (chat.branchTree && !input.chat.branchTree) chat.messages = materializeActivePath(chat.branchTree, contentStore, true);
    if (historyBase) capture?.(historyBase, {chats:[chat],contentStore});
    const changes = diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore })));
    return JSON.stringify({ status: changes.length ? 'updated' : 'unchanged', nodeId, path: chat.branchTree?.activePath, changes });
  });
}
