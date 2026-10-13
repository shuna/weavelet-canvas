import type { BranchEditCapture, BranchHistoryState } from '../../src/utils/branchHistory';
import { ensureBranchTreeState, removeNodeState, pruneHiddenNodesState, switchActivePathState } from '../../src/store/branch-domain';
import { materializeActivePath } from '../../src/utils/branchUtils';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { resolveContent } from '../../src/utils/contentStore';
import { withEditingRuntime } from './editing';
import type { ChatInterface } from '../../src/types/chat';
import type { ContentStoreData } from '../../src/utils/contentStore';

type Input = { chat: ChatInterface; contentStore: ContentStoreData; nodeID?: string | null; viewingPath: string[];
  operation: 'remove' | 'pruneHidden'; newIDs: string[]; now: number };
export function nodeRemoval(json: string, capture?: BranchEditCapture): string {
  const input = JSON.parse(json) as Input;
  if (input.operation !== 'remove' && input.operation !== 'pruneHidden') throw new Error('Invalid removal operation.');
  const before = { chat: input.chat, contentStore: input.contentStore };
  let { chat, contentStore } = structuredClone(before);
  if (!Array.isArray(chat.messages) && chat.branchTree) chat.messages = materializeActivePath(chat.branchTree, contentStore);
  const wasFlat = !chat.branchTree;
  return withEditingRuntime(input.newIDs, Object.keys(chat.branchTree?.nodes ?? {}), input.now, () => {
    let result = { chats: [chat], contentStore };
    if (!wasFlat) {
      result = ensureBranchTreeState(result.chats, 0, result.contentStore);
      if (input.viewingPath.some(id => !Object.hasOwn(result.chats[0].branchTree!.nodes, id))) throw new Error('Invalid viewing path.');
      result.chats = switchActivePathState(result.chats, 0, input.viewingPath, result.contentStore);
    }
    let historyBase: BranchHistoryState = result;
    if (input.operation === 'remove') {
      if (input.nodeID == null) throw new Error('Invalid removal target.');
      const nodeId = wasFlat && input.nodeID.startsWith('message-') ? input.nodeID.slice(8) : input.nodeID;
      const removed = removeNodeState(result.chats, { chatId: chat.id, nodeId }, result.contentStore);
      if (removed.status !== 'updated') throw new Error(`Cannot remove node: ${removed.status}`);
      historyBase = removed.historyBase ?? historyBase;
      result = removed;
    } else {
      // A flat chat has no hidden branches; keep it flat and avoid allocating IDs.
      if (wasFlat) return '[]';
      result = pruneHiddenNodesState(result.chats, 0, result.contentStore);
    }
    // Delta promotion must resolve against projected parts before opaque values
    // return to the raw native document, as in the editing bridge.
    for (const [hash, entry] of Object.entries(result.contentStore)) {
      if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
        const content = resolveContent(result.contentStore, hash);
        const { delta: _delta, ...full } = entry;
        result.contentStore[hash] = { ...full, content };
      }
    }
    chat = result.chats[0]; contentStore = result.contentStore;
    // materializeActivePath projects only remaining nodes; do not carry sidecar
    // rows of removed nodes into the redundant message array.
    if (chat.branchTree) chat.messages = materializeActivePath(chat.branchTree, contentStore, true);
    capture?.(historyBase, result);
    return JSON.stringify(diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore }))));
  });
}
