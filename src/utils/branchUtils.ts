import { isEqual } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import {
  BranchNode,
  BranchTree,
  BranchSwipeDirection,
  ChatInterface,
  ContentInterface,
  MessageInterface,
  MessageAttributesV1,
  BranchClipboard,
  Role,
} from '@type/chat';
import {
  ContentStoreData,
  addContent,
  resolveContent,
  releaseContent,
} from './contentStore';

export function readMessageAttributes(owner: BranchTree | BranchClipboard): MessageAttributesV1 | undefined {
  const value = owner.messageAttributesV1;
  if (!Object.hasOwn(owner, 'messageAttributesV1')) return undefined;
  if (!value || value.version !== 1 || !value.byNode || typeof value.byNode !== 'object' || Array.isArray(value.byNode) ||
      Object.keys(value).some(key => key !== 'version' && key !== 'byNode') ||
      Object.keys(value.byNode).some(id => !Object.hasOwn(owner.nodes, id)) ||
      Object.values(value.byNode).some(attributes => !attributes || typeof attributes !== 'object' || Array.isArray(attributes) || Object.hasOwn(attributes, 'role') || Object.hasOwn(attributes, 'content'))) {
    throw new Error('Unsupported message attributes namespace.');
  }
  return value;
}

export const extraMessageAttributes = (message: MessageInterface) => {
  const { role, content, ...attributes } = message;
  return attributes as Record<string, unknown>;
};

export function setMessageAttributes(owner: BranchTree | BranchClipboard, nodeId: string, message: MessageInterface) {
  const attributes = extraMessageAttributes(message);
  if (!Object.keys(attributes).length) return;
  const previous = readMessageAttributes(owner);
  owner.messageAttributesV1 = { version: 1, byNode: {
    ...previous?.byNode, [nodeId]: { ...previous?.byNode[nodeId], ...structuredClone(attributes) },
  } };
}

export function copyMessageAttributes(source: BranchTree | BranchClipboard, sourceId: string, target: BranchTree | BranchClipboard, targetId: string) {
  const attributes = readMessageAttributes(source)?.byNode[sourceId];
  if (!attributes) return;
  setMessageAttributes(target, targetId, { ...attributes, role: 'user', content: [] });
}

export function deleteMessageAttributes(owner: BranchTree | BranchClipboard, nodeId: string) {
  const previous = readMessageAttributes(owner);
  if (!previous || !Object.hasOwn(previous.byNode, nodeId)) return;
  const byNode = { ...previous.byNode };
  delete byNode[nodeId];
  owner.messageAttributesV1 = { version: 1, byNode };
}

// Capture only rows with opaque attributes; ordinary redundant projections need no correspondence check.
export function captureProjectedMessageAttributes(chat: Partial<Pick<ChatInterface, 'branchTree' | 'messages'>>, contentStore: ContentStoreData): void {
  if (!chat.branchTree) return;
  let next = chat.branchTree;
  for (const [index, message] of (chat.messages ?? []).entries()) {
    const attributes = extraMessageAttributes(message);
    if (!Object.keys(attributes).length) continue;
    const nodeId = chat.branchTree.activePath[index], node = chat.branchTree.nodes[nodeId];
    if (!node || node.role !== message.role || !isEqual(resolveContent(contentStore, node.contentHash), message.content)) throw new Error('Message attributes do not match the active branch.');
    const existing = readMessageAttributes(next)?.byNode[nodeId];
    for (const [key, value] of Object.entries(attributes)) if (existing && Object.hasOwn(existing, key) && !isEqual(existing[key], value)) throw new Error('Conflicting projected message attributes.');
    if (next === chat.branchTree) next = { ...next };
    setMessageAttributes(next, nodeId, message);
  }
  chat.branchTree = next;
}

export function resolveBranchSwipeDirection(distance: number, preference: BranchSwipeDirection = 'left-next'): 'previous' | 'next' {
  return (distance < 0) === (preference === 'left-next') ? 'next' : 'previous';
}

export function projectMessageAttributes(owner: BranchTree | BranchClipboard, nodeId: string, message: MessageInterface): MessageInterface {
  return { ...structuredClone(readMessageAttributes(owner)?.byNode[nodeId] ?? {}), role: message.role, content: message.content };
}

export function materializeActivePath(
  tree: BranchTree,
  contentStore: ContentStoreData,
  includeAttributes = false
): MessageInterface[] {
  return tree.activePath.map((id) => {
    const node = tree.nodes[id];
    const message = { role: node.role, content: resolveContent(contentStore, node.contentHash) };
    return includeAttributes ? projectMessageAttributes(tree, id, message) : message;
  });
}

export function upsertActivePathMessage(
  chat: ChatInterface,
  index: number,
  message: MessageInterface,
  contentStore: ContentStoreData
) {
  if (!chat.branchTree || index < 0) return;

  const tree = chat.branchTree;
  const existingId = tree.activePath[index];

  if (existingId) {
    setMessageAttributes(tree, existingId, message);
    const oldHash = tree.nodes[existingId].contentHash;
    const newHash = addContent(contentStore, message.content);
    releaseContent(contentStore, oldHash);
    tree.nodes[existingId] = {
      ...tree.nodes[existingId],
      role: message.role,
      contentHash: newHash,
    };
    return;
  }

  if (index !== tree.activePath.length) return;

  const parentId =
    index === 0 ? null : tree.activePath[tree.activePath.length - 1] ?? null;
  const newId = uuidv4();
  const contentHash = addContent(contentStore, message.content);

  tree.nodes[newId] = {
    id: newId,
    parentId,
    role: message.role,
    contentHash,
    createdAt: Date.now(),
  };
  setMessageAttributes(tree, newId, message);
  tree.activePath.push(newId);
}

export function truncateActivePathAfterIndex(
  chat: ChatInterface,
  lastIndexInclusive: number
) {
  if (!chat.branchTree) return;
  chat.branchTree.activePath = chat.branchTree.activePath.slice(
    0,
    lastIndexInclusive + 1
  );
}

export function deleteActivePathMessage(
  chat: ChatInterface,
  index: number,
  contentStore: ContentStoreData
) {
  if (!chat.branchTree || index < 0) return;

  const tree = chat.branchTree;
  const nodeId = tree.activePath[index];
  if (!nodeId) return;

  const parentId = tree.nodes[nodeId]?.parentId ?? null;
  Object.values(tree.nodes).forEach((node) => {
    if (node.parentId === nodeId) {
      node.parentId = parentId;
    }
  });

  releaseContent(contentStore, tree.nodes[nodeId].contentHash);
  deleteMessageAttributes(tree, nodeId);
  delete tree.nodes[nodeId];
  tree.activePath.splice(index, 1);
}

export function flatMessagesToBranchTree(
  messages: MessageInterface[],
  contentStore: ContentStoreData
): BranchTree {
  const nodes: Record<string, BranchNode> = {};
  const ids: string[] = [];
  const tree: BranchTree = { nodes, rootId: '', activePath: ids };

  for (let i = 0; i < messages.length; i++) {
    const id = uuidv4();
    ids.push(id);
    const contentHash = addContent(contentStore, messages[i].content);
    nodes[id] = {
      id,
      parentId: i === 0 ? null : ids[i - 1],
      role: messages[i].role,
      contentHash,
      createdAt: Date.now() - (messages.length - i) * 1000,
    };
    setMessageAttributes(tree, id, messages[i]);
  }

  tree.rootId = ids[0] ?? '';
  return tree;
}

export function flatChatToBranchTree(chat: ChatInterface, contentStore: ContentStoreData): void {
  if (chat.branchTree) return;
  const tree = flatMessagesToBranchTree(chat.messages, contentStore);
  const remapFlatNodeId = (id: string) => {
    const index = Number(id);
    return Number.isInteger(index) && index >= 0 && String(index) === id
      ? tree.activePath[index] ?? id
      : id;
  };
  for (const field of ['collapsedNodes', 'omittedNodes', 'protectedNodes', 'summaryTargets'] as const) {
    if (!chat[field]) continue;
    chat[field] = Object.fromEntries(Object.entries(chat[field]!).map(([key, value]) => [remapFlatNodeId(key), value]));
  }
  if (chat.summaries) chat.summaries = chat.summaries.map(summary => ({
    ...summary,
    sources: summary.sources.map(source => ({
      ...source,
      nodeId: remapFlatNodeId(source.nodeId),
      // Flat summaries use null for every parent; rebuild that relation from the new tree.
      // A non-null legacy value was never valid for a flat chat, so preserve it as invalid.
      parentId: source.parentId === null
        ? tree.nodes[remapFlatNodeId(source.nodeId)]?.parentId ?? null
        : source.parentId,
    })),
  }));
  chat.branchTree = tree;
  chat.messages = materializeActivePath(tree, contentStore);
}

export function getChildrenOf(
  tree: BranchTree,
  nodeId: string
): BranchNode[] {
  return Object.values(tree.nodes).filter((n) => n.parentId === nodeId);
}

// Group once for batch callers. Object.values order and the original root-parent
// rule are shared with the single-node Web accessor below.
export function getSiblingGroups(tree: BranchTree) {
  const grouped = new Map<string | null, BranchNode[]>();
  const nodes = Object.values(tree.nodes);
  for (const node of nodes) {
    const group = grouped.get(node.parentId) ?? [];
    group.push(node); grouped.set(node.parentId,group);
  }
  const groups: BranchNode[][] = [];
  const byParent = new Map<string | null,number>();
  const byNode: Record<string,{groupIndex:number;selectedIndex:number}> = Object.create(null);
  for (const node of nodes) {
    const parent = node.parentId || null;
    let groupIndex = byParent.get(parent);
    if (groupIndex === undefined) {
      groupIndex = groups.length; byParent.set(parent,groupIndex);
      const group = grouped.get(parent) ?? [];
      groups.push(group);
      group.forEach((sibling,index) => { byNode[sibling.id] = {groupIndex:groupIndex!,selectedIndex:index}; });
    }
    // Invalid falsy parents still follow the former accessor's null-parent lookup.
    if (!byNode[node.id]) byNode[node.id] = {groupIndex,selectedIndex:-1};
  }
  return {groups,byNode};
}
export function getSiblingsOf(tree: BranchTree, nodeId: string): BranchNode[] {
  const node = tree.nodes[nodeId];
  if (!node) return [];
  const result = getSiblingGroups(tree);
  return result.groups[result.byNode[node.id].groupIndex];
}

export function buildPathToLeaf(
  tree: BranchTree,
  nodeId: string
): string[] {
  // Walk from root to nodeId
  const ancestors: string[] = [];
  let cur: string | null = nodeId;
  while (cur) {
    ancestors.unshift(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }

  // Extend from nodeId to deepest child (prefer most recent)
  let tip = nodeId;
  while (true) {
    const children = getChildrenOf(tree, tip);
    if (children.length === 0) break;
    children.sort((a, b) => b.createdAt - a.createdAt);
    ancestors.push(children[0].id);
    tip = children[0].id;
  }

  return ancestors;
}

export function findLCA(
  tree: BranchTree,
  nodeIdA: string,
  nodeIdB: string
): string | null {
  const ancestorsA = new Set<string>();
  let cur: string | null = nodeIdA;
  while (cur) {
    ancestorsA.add(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  cur = nodeIdB;
  while (cur) {
    if (ancestorsA.has(cur)) return cur;
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return null;
}

export function buildNodeDiffPaths(tree: BranchTree, nodeIdA: string, nodeIdB: string): {pathA: string[]; pathB: string[]} {
  const fullPathA = buildPathToLeaf(tree, nodeIdA);
  const fullPathB = buildPathToLeaf(tree, nodeIdB);
  const lca = findLCA(tree, nodeIdA, nodeIdB);
  let pathA = fullPathA;
  let pathB = fullPathB;
  if (lca) {
    const idxA = fullPathA.indexOf(lca);
    const idxB = fullPathB.indexOf(lca);
    if (idxA >= 0) pathA = fullPathA.slice(idxA + 1);
    if (idxB >= 0) pathB = fullPathB.slice(idxB + 1);
    if (nodeIdA === lca) pathA = fullPathA.slice(idxA);
    if (nodeIdB === lca) pathB = fullPathB.slice(idxB);
  }
  return {pathA, pathB};
}

export function collectDescendants(
  tree: BranchTree,
  nodeId: string
): Set<string> {
  const result = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    result.add(id);
    for (const child of getChildrenOf(tree, id)) {
      queue.push(child.id);
    }
  }
  return result;
}

export interface RegenerateTarget {
  removeIndex: number;
  submitMode: 'append' | 'insert';
  insertIndex: number;
}

export function resolveRegenerateTarget(
  role: Role,
  messageIndex: number,
  messagesLength: number
): RegenerateTarget | null {
  if (role === 'system') return null;

  if (role === 'assistant') {
    const afterRemoval = messagesLength - 1;
    return {
      removeIndex: messageIndex,
      submitMode: messageIndex >= afterRemoval ? 'append' : 'insert',
      insertIndex: messageIndex,
    };
  }

  // user: target the next assistant message
  const nextIndex = messageIndex + 1;
  const hasNext = nextIndex < messagesLength;
  const lengthAfterRemoval = hasNext ? messagesLength - 1 : messagesLength;
  return {
    removeIndex: hasNext ? nextIndex : -1,
    submitMode: nextIndex >= lengthAfterRemoval ? 'append' : 'insert',
    insertIndex: nextIndex,
  };
}
