import { hasMeaningfulContent } from '../../src/utils/contentValidation';
import { textValueOf, replaceTextValue } from '../../src/utils/messageText';
import {
  ensureBranchTreeState, switchActivePathState, upsertWithAutoBranchState,
  createBranchState, appendNodeToActivePathState, updateNodeRoleState,
} from '../../src/store/branch-domain';
import { materializeActivePath } from '../../src/utils/branchUtils';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { ChatInterface, ContentInterface, Role } from '../../src/types/chat';
import { resolveContent, type ContentStoreData } from '../../src/utils/contentStore';

let runtime: { ids: string[]; reserved: Set<string> } | undefined;
// The bundle UUID adapter uses this only for editing. Native supplies the same
// UUIDs it already allocates at its UI boundary; Web originals remain unchanged.
export function editingUUID(): string {
  if (!runtime) return crypto.randomUUID();
  const id = runtime.ids.shift();
  if (!id || runtime!.reserved.has(id)) throw new Error('Invalid new node ID.');
  runtime!.reserved.add(id);
  return id;
}
export function withEditingRuntime<T>(newIDs: string[], existingIDs: string[], now: number, operation: () => T): T {
  const clock = Date.now;
  runtime = { ids: [...newIDs], reserved: new Set(existingIDs) };
  Date.now = () => now;
  try { return operation(); }
  finally { Date.now = clock; runtime = undefined; }
}
export function messageEdit(json: string): string {
  const input: { chat: ChatInterface; contentStore: ContentStoreData; nodeID?: string; viewingPath: string[];
    role: Role; parts: ContentInterface[]; editedText?: string; operation?: 'textValue'; mode: 'overwrite' | 'branch' | 'append'; newIDs: string[]; now: number } = JSON.parse(json);
  if (input.operation === 'textValue') return JSON.stringify(textValueOf(input.parts));
  if (input.editedText !== undefined && typeof input.editedText !== 'string') throw new Error('Invalid text.');
  const parts = input.editedText !== undefined && input.editedText !== textValueOf(input.parts) ? replaceTextValue(input.parts, input.editedText) : input.parts;
  if (!['user', 'assistant', 'system'].includes(input.role) || !Array.isArray(input.parts)) throw new Error('Invalid message.');
  if (input.mode === 'append' && input.editedText !== undefined && !hasMeaningfulContent(parts)) throw new Error('本文を入力してください');
  const before = { chat: input.chat, contentStore: input.contentStore };
  const isolated = structuredClone(before);
  let chat = isolated.chat;
  if (!Array.isArray(chat.messages) && chat.branchTree) chat.messages = materializeActivePath(chat.branchTree, isolated.contentStore);
  const wasFlat = !chat.branchTree;
  return withEditingRuntime(input.newIDs, Object.keys(chat.branchTree?.nodes ?? {}), input.now, () => {
    let result = ensureBranchTreeState([chat], 0, isolated.contentStore);
    if (!wasFlat) {
      const path = input.viewingPath;
      if (path.some(id => !Object.hasOwn(result.chats[0].branchTree!.nodes, id))) throw new Error('Invalid viewing path.');
      if (path.length) result.chats = switchActivePathState(result.chats, 0, path, result.contentStore);
      else result.chats[0].branchTree!.activePath = [];
    }
    const tree = result.chats[0].branchTree!;
    let index = -1;
    if (input.mode !== 'append') {
      const flatID = input.nodeID?.startsWith('message-') ? input.nodeID.slice(8) : input.nodeID;
      index = wasFlat && flatID !== undefined && String(Number(flatID)) === flatID ? Number(flatID) : tree.activePath.indexOf(input.nodeID!);
      if (!Number.isInteger(index) || index < 0 || index >= tree.activePath.length) throw new Error('Invalid message node ID.');
      if (input.mode === 'overwrite' && result.chats[0].protectedNodes?.[tree.activePath[index]]) throw new Error('Protected message.');
    }
    if (input.mode === 'append') result = appendNodeToActivePathState(result.chats, 0, input.role, parts, result.contentStore);
    else if (input.mode === 'branch') {
      const branch = createBranchState(result.chats, 0, tree.activePath[index], parts, result.contentStore);
      result = branch;
      if (branch.chats[0].branchTree!.nodes[branch.newId].role !== input.role) {
        result.chats = updateNodeRoleState(branch.chats, 0, branch.newId, input.role, branch.contentStore);
      }
    } else result = upsertWithAutoBranchState(result.chats, 0, index, { role: input.role, content: parts }, result.contentStore);
    // DMP patch strings cannot carry opaque references back to raw native JSON.
    // Expand only deltas produced by this operation while their projected base
    // is still available; existing native deltas stay in the raw document.
    for (const [hash, entry] of Object.entries(result.contentStore)) {
      if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
        const content = resolveContent(result.contentStore, hash);
        const { delta: _delta, ...full } = entry;
        result.contentStore[hash] = { ...full, content };
      }
    }
    chat = result.chats[0];
    // Native's external source includes the full projection; LLM/UI runtime
    // projection inside the Web functions stays role/content only.
    chat.messages = materializeActivePath(chat.branchTree!, result.contentStore, true);
    return JSON.stringify(diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore: result.contentStore }))));
  });
}
