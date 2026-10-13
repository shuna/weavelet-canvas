import {
  BranchClipboard,
  BranchNode,
  ChatInterface,
  ContentInterface,
  MessageInterface,
  Role,
  isTextContent,
} from '@type/chat';
import {
  buildPathToLeaf,
  collectDescendants,
  flatChatToBranchTree,
  getChildrenOf,
  materializeActivePath,
  captureProjectedMessageAttributes,
  readMessageAttributes,
  setMessageAttributes,
  copyMessageAttributes,
  deleteMessageAttributes,
} from '@utils/branchUtils';
import {
  ContentStoreData,
  addContent,
  addContentDelta,
  isContentEqual,
  releaseContent,
  resolveContent,
  retainContent,
} from '@utils/contentStore';
import { v4 as uuidv4 } from 'uuid';

/** Extract concatenated text from content array */
const extractSystemText = (content: ContentInterface[]): string =>
  content.filter(isTextContent).map((c) => c.text).filter(Boolean).join('\n');

/** Sync system bubble content → config.systemPrompt when index-0 system node is edited */
const syncBubbleToConfig = (
  chat: ChatInterface,
  tree: NonNullable<ChatInterface['branchTree']>,
  contentStore: ContentStoreData
): void => {
  const topNodeId = tree.activePath[0];
  if (!topNodeId) return;
  const topNode = tree.nodes[topNodeId];
  if (!topNode || topNode.role !== 'system') return;
  const content = resolveContent(contentStore, topNode.contentHash);
  chat.config = { ...chat.config, systemPrompt: extractSystemText(content) || undefined };
};

export const cloneChatAt = (
  chats: ChatInterface[],
  chatIndex: number
): ChatInterface[] => {
  const result = chats.slice();
  const chat = result[chatIndex];
  result[chatIndex] = {
    ...chat,
    messages: chat.messages.slice(),
    branchTree: chat.branchTree
      ? {
          ...chat.branchTree,
          nodes: { ...chat.branchTree.nodes },
          activePath: chat.branchTree.activePath.slice(),
          ...(chat.branchTree.messageAttributesV1 ? { messageAttributesV1: structuredClone(readMessageAttributes(chat.branchTree)) } : {}),
        }
      : undefined,
    collapsedNodes: chat.collapsedNodes
      ? { ...chat.collapsedNodes }
      : undefined,
    omittedNodes: chat.omittedNodes
      ? { ...chat.omittedNodes }
      : undefined,
    protectedNodes: chat.protectedNodes
      ? { ...chat.protectedNodes }
      : undefined,
  };
  return result;
};

const cloneNode = (node: BranchNode): BranchNode => ({ ...node });

const ensureBranchReadyState = (
  chats: ChatInterface[],
  chatIndex: number,
  currentContentStore: ContentStoreData
) => {
  // Entries are mutable (refCount and delta promotion); keep the previous
  // snapshot's entry objects intact while sharing immutable bodies/metadata.
  const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
  const ensured = ensureBranchTreeState(chats, chatIndex, contentStore);
  return { chats: cloneChatAt(ensured.chats, chatIndex), contentStore: ensured.contentStore };
};

const cloneNodeIfPresent = (
  tree: NonNullable<ChatInterface['branchTree']>,
  nodeId: string | null | undefined
) => {
  if (!nodeId) return;
  const node = tree.nodes[nodeId];
  if (!node) return;
  tree.nodes[nodeId] = cloneNode(node);
};

type PreparedBranchMutationState = {
  chats: ChatInterface[];
  chat: ChatInterface;
  tree: NonNullable<ChatInterface['branchTree']>;
  contentStore: ContentStoreData;
};

const prepareBranchMutationState = (
  chats: ChatInterface[],
  chatIndex: number,
  currentContentStore: ContentStoreData
): PreparedBranchMutationState => {
  const { chats: updatedChats, contentStore } = ensureBranchReadyState(
    chats,
    chatIndex,
    currentContentStore
  );
  const chat = updatedChats[chatIndex];
  return {
    chats: updatedChats,
    chat,
    tree: chat.branchTree!,
    contentStore,
  };
};

const finalizePreparedBranchMutationState = ({
  chats,
  chat,
  tree,
  contentStore,
}: PreparedBranchMutationState) => {
  tree.rootId = tree.activePath[0] ?? '';
  chat.messages = materializeActivePath(tree, contentStore);
  return { chats, contentStore };
};

const removeMessageAtIndexFromPreparedState = (
  state: PreparedBranchMutationState,
  messageIndex: number,
  options?: { preserveNode?: boolean }
) => {
  const { tree, contentStore } = state;
  const nodeId = tree.activePath[messageIndex];

  if (!nodeId) return;

  const parentId = tree.nodes[nodeId]?.parentId ?? null;
  const nextId = tree.activePath[messageIndex + 1] ?? null;

  Object.values(tree.nodes).forEach((node) => {
    if (node.parentId !== nodeId) return;
    tree.nodes[node.id] = {
      ...node,
      parentId,
    };
  });

  if (nextId) {
    cloneNodeIfPresent(tree, nextId);
    tree.nodes[nextId].parentId = parentId;
  }

  if (!options?.preserveNode) {
    releaseContent(contentStore, tree.nodes[nodeId].contentHash);
    deleteMessageAttributes(tree, nodeId);
    delete tree.nodes[nodeId];
  }
  tree.activePath.splice(messageIndex, 1);
};

export const ensureBranchTreeState = (
  chats: ChatInterface[],
  chatIndex: number,
  currentContentStore: ContentStoreData
) => {
  if (chats[chatIndex]?.branchTree) {
    if (chats[chatIndex].messages.some(message => Object.keys(message).some(key => key !== 'role' && key !== 'content'))) {
      const updatedChats = cloneChatAt(chats, chatIndex);
      captureProjectedMessageAttributes(updatedChats[chatIndex], currentContentStore);
      return { chats: updatedChats, contentStore: currentContentStore };
    }
    return { chats, contentStore: currentContentStore };
  }

  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  flatChatToBranchTree(updatedChats[chatIndex], contentStore);

  return { chats: updatedChats, contentStore };
};

export const createBranchState = (
  chats: ChatInterface[],
  chatIndex: number,
  fromNodeId: string,
  newContent: ContentInterface[] | undefined,
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
  const tree = updatedChats[chatIndex].branchTree!;
  const fromNode = tree.nodes[fromNodeId];

  const newId = uuidv4();
  const contentHash = newContent
    ? addContentDelta(contentStore, newContent, fromNode.contentHash)
    : (() => {
        retainContent(contentStore, fromNode.contentHash);
        return fromNode.contentHash;
      })();

  tree.nodes[newId] = {
    id: newId,
    parentId: fromNode.parentId,
    role: fromNode.role,
    contentHash,
    createdAt: Date.now(),
  };

  copyMessageAttributes(tree, fromNodeId, tree, newId);
  const fromIdx = tree.activePath.indexOf(fromNodeId);
  tree.activePath = [...tree.activePath.slice(0, fromIdx), newId];
  if (fromIdx === 0) syncBubbleToConfig(updatedChats[chatIndex], tree, contentStore);
  updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);

  return { chats: updatedChats, contentStore, newId };
};

export const switchActivePathState = (
  chats: ChatInterface[],
  chatIndex: number,
  newPath: string[],
  contentStore: ContentStoreData
) => {
  const updatedChats = cloneChatAt(chats, chatIndex);
  captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
  const tree = updatedChats[chatIndex].branchTree!;
  tree.activePath = newPath;
  updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
  return updatedChats;
};

export const switchBranchAtNodeState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeId: string,
  contentStore: ContentStoreData
) => {
  const tree = chats[chatIndex].branchTree!;
  return switchActivePathState(
    chats,
    chatIndex,
    buildPathToLeaf(tree, nodeId),
    contentStore
  );
};

export const deleteBranchState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeId: string,
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
  const tree = updatedChats[chatIndex].branchTree!;
  const toDelete = collectDescendants(tree, nodeId);
  const parentId = tree.nodes[nodeId]?.parentId;

  toDelete.forEach((id) => {
    releaseContent(contentStore, tree.nodes[id].contentHash);
    deleteMessageAttributes(tree, id);
    delete tree.nodes[id];
  });

  if (tree.activePath.some((id) => toDelete.has(id))) {
    if (parentId) {
      const siblings = getChildrenOf(tree, parentId);
      if (siblings.length > 0) {
        tree.activePath = buildPathToLeaf(tree, siblings[0].id);
      } else {
        const parentIdx = tree.activePath.indexOf(parentId);
        tree.activePath = tree.activePath.slice(0, parentIdx + 1);
      }
    } else {
      tree.activePath = [];
    }
    updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
  }

  return { chats: updatedChats, contentStore };
};

export const pruneHiddenNodesState = (
  chats: ChatInterface[],
  chatIndex: number,
  currentContentStore: ContentStoreData
) => {
  const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
  const updatedChats = cloneChatAt(chats, chatIndex);
  captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
  const tree = updatedChats[chatIndex].branchTree!;
  const activeSet = new Set(tree.activePath);

  // Collect pinned subtrees (pinned nodes and all their descendants)
  const protectedSet = new Set<string>();
  for (const node of Object.values(tree.nodes)) {
    if (node.pinned) {
      for (const id of collectDescendants(tree, node.id)) {
        protectedSet.add(id);
      }
    }
  }
  // Also protect nodes marked via protectedNodes on the chat
  const chatProtectedNodes = updatedChats[chatIndex].protectedNodes;
  if (chatProtectedNodes) {
    for (const [id, value] of Object.entries(chatProtectedNodes)) {
      if (value && tree.nodes[id]) {
        protectedSet.add(id);
      }
    }
  }

  const toDelete = Object.keys(tree.nodes).filter(
    (id) => !activeSet.has(id) && !protectedSet.has(id)
  );
  toDelete.forEach((id) => {
    releaseContent(contentStore, tree.nodes[id].contentHash);
    deleteMessageAttributes(tree, id);
    delete tree.nodes[id];
  });

  // Fix parent pointers: nodes whose parent was deleted get parentId=null
  for (const id of Object.keys(tree.nodes)) {
    const node = tree.nodes[id];
    if (node.parentId && !tree.nodes[node.parentId]) {
      tree.nodes[id] = cloneNode(node);
      tree.nodes[id].parentId = null;
    }
  }

  if (tree.activePath.length > 0) tree.rootId = tree.activePath[0];
  else if (!tree.nodes[tree.rootId]) tree.rootId = '';

  return { chats: updatedChats, contentStore };
};

export const setBranchNodeFieldState = (
  chats: ChatInterface[], chatIndex: number, nodeId: string,
  field: 'label' | 'starred' | 'pinned', value: string | true | undefined
) => {
  const updated = cloneChatAt(chats, chatIndex);
  const tree = updated[chatIndex].branchTree!;
  tree.nodes[nodeId] = { ...tree.nodes[nodeId], [field]: value };
  return updated;
};

export const appendNodeToActivePathState = (
  chats: ChatInterface[],
  chatIndex: number,
  role: Role,
  content: ContentInterface[],
  currentContentStore: ContentStoreData
) => {
  const { chats: updatedChats, chat, tree, contentStore } =
    prepareBranchMutationState(chats, chatIndex, currentContentStore);
  const parentId = tree.activePath[tree.activePath.length - 1] ?? null;
  const newId = uuidv4();

  tree.nodes[newId] = {
    id: newId,
    parentId,
    role,
    contentHash: addContent(contentStore, content),
    createdAt: Date.now(),
  };
  tree.activePath.push(newId);

  const finalized = finalizePreparedBranchMutationState({
    chats: updatedChats,
    chat,
    tree,
    contentStore,
  });

  return { ...finalized, newId };
};

export const upsertMessageAtIndexState = (
  chats: ChatInterface[],
  chatIndex: number,
  messageIndex: number,
  message: MessageInterface,
  currentContentStore: ContentStoreData
) => {
  const { chats: updatedChats, chat, tree, contentStore } =
    prepareBranchMutationState(chats, chatIndex, currentContentStore);
  const existingId = tree.activePath[messageIndex];

  const previousRole = existingId ? tree.nodes[existingId].role : undefined;
  chat.messages[messageIndex] = message;
  if (existingId) setMessageAttributes(tree, existingId, message);

  if (existingId) {
    const oldHash = tree.nodes[existingId].contentHash;
    // Delta vs full: addContentDelta attempts delta compression against oldHash.
    // If oldHash refCount drops to 0 on release, promoteDependents will promote
    // the delta back to full — this is intentional. Delta only persists when the
    // base is shared (e.g., another branch references it). The diff computation
    // overhead for the single-ref case is negligible.
    const newHash = addContentDelta(contentStore, message.content, oldHash);
    releaseContent(contentStore, oldHash);
    tree.nodes[existingId] = {
      ...tree.nodes[existingId],
      role: message.role,
      contentHash: newHash,
    };
  } else if (messageIndex === tree.activePath.length) {
    const parentId =
      messageIndex === 0 ? null : tree.activePath[messageIndex - 1] ?? null;
    const newId = uuidv4();
    tree.nodes[newId] = {
      id: newId,
      parentId,
      role: message.role,
      contentHash: addContent(contentStore, message.content),
      createdAt: Date.now(),
    };
    setMessageAttributes(tree, newId, message);
    tree.activePath.push(newId);
    if (messageIndex === 0) {
      tree.rootId = newId;
    }
  }

  // Sync: if index-0 system node was edited, update config.systemPrompt
  if (messageIndex === 0) {
    if (previousRole === 'system' && message.role !== 'system') {
      chat.config = { ...chat.config, systemPrompt: undefined };
    } else {
      syncBubbleToConfig(chat, tree, contentStore);
    }
  }

  return finalizePreparedBranchMutationState({
    chats: updatedChats,
    chat,
    tree,
    contentStore,
  });
};

export const insertMessageAtIndexState = (
  chats: ChatInterface[],
  chatIndex: number,
  messageIndex: number,
  message: MessageInterface,
  currentContentStore: ContentStoreData
) => {
  const { chats: updatedChats, chat, tree, contentStore } =
    prepareBranchMutationState(chats, chatIndex, currentContentStore);
  const prevId = messageIndex > 0 ? tree.activePath[messageIndex - 1] ?? null : null;
  const nextId = tree.activePath[messageIndex];
  const newId = uuidv4();

  tree.nodes[newId] = {
    id: newId,
    parentId: prevId,
    role: message.role,
    contentHash: addContent(contentStore, message.content),
    createdAt: Date.now(),
  };

  if (nextId) {
    cloneNodeIfPresent(tree, nextId);
    tree.nodes[nextId].parentId = newId;
  }

  setMessageAttributes(tree, newId, message);
  tree.activePath.splice(messageIndex, 0, newId);
  if (messageIndex === 0) {
    tree.rootId = newId;
  }

  const finalized = finalizePreparedBranchMutationState({
    chats: updatedChats,
    chat,
    tree,
    contentStore,
  });
  return { ...finalized, newId };
};

export const updateLastNodeContentState = (
  chats: ChatInterface[],
  chatIndex: number,
  content: ContentInterface[],
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
  const tree = updatedChats[chatIndex].branchTree!;
  const lastId = tree.activePath[tree.activePath.length - 1];

  if (lastId) {
    const oldHash = tree.nodes[lastId].contentHash;
    // See upsertMessageAtIndexState for delta-on-edit rationale
    const newHash = addContentDelta(contentStore, content, oldHash);
    releaseContent(contentStore, oldHash);
    tree.nodes[lastId] = cloneNode(tree.nodes[lastId]);
    tree.nodes[lastId].contentHash = newHash;
    updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
  }

  return { chats: updatedChats, contentStore };
};

export const removeMessageAtIndexState = (
  chats: ChatInterface[],
  chatIndex: number,
  messageIndex: number,
  currentContentStore: ContentStoreData,
  options?: { preserveNode?: boolean }
) => {
  const state = prepareBranchMutationState(chats, chatIndex, currentContentStore);
  removeMessageAtIndexFromPreparedState(state, messageIndex, options);
  return finalizePreparedBranchMutationState(state);
};

export const moveMessageState = (
  chats: ChatInterface[],
  chatIndex: number,
  messageIndex: number,
  direction: 'up' | 'down',
  currentContentStore: ContentStoreData
) => {
  const { chats: updatedChats, chat, tree, contentStore } =
    prepareBranchMutationState(chats, chatIndex, currentContentStore);
  const targetIndex = direction === 'up' ? messageIndex - 1 : messageIndex + 1;

  // Guard: system node at index 0 is pinned — cannot be moved or swapped with
  const topNode = tree.activePath[0] ? tree.nodes[tree.activePath[0]] : undefined;
  if (topNode?.role === 'system') {
    if (messageIndex === 0 || targetIndex === 0) {
      return finalizePreparedBranchMutationState({
        chats: updatedChats,
        chat,
        tree,
        contentStore,
      });
    }
  }

  if (
    targetIndex < 0 ||
    targetIndex >= tree.activePath.length ||
    messageIndex < 0 ||
    messageIndex >= tree.activePath.length
  ) {
    return finalizePreparedBranchMutationState({
      chats: updatedChats,
      chat,
      tree,
      contentStore,
    });
  }

  const start = Math.min(messageIndex, targetIndex);
  const end = Math.max(messageIndex, targetIndex);
  const reorderedPath = tree.activePath.slice();
  const [movedId] = reorderedPath.splice(messageIndex, 1);
  reorderedPath.splice(targetIndex, 0, movedId);
  tree.activePath = reorderedPath;

  for (let index = start; index <= end + 1; index += 1) {
    const nodeId = tree.activePath[index];
    if (!nodeId) continue;
    cloneNodeIfPresent(tree, nodeId);
    tree.nodes[nodeId].parentId = index === 0 ? null : tree.activePath[index - 1] ?? null;
  }

  return finalizePreparedBranchMutationState({
    chats: updatedChats,
    chat,
    tree,
    contentStore,
  });
};

export const replaceMessageAndPruneFollowingState = (
  chats: ChatInterface[],
  chatIndex: number,
  messageIndex: number,
  message: MessageInterface,
  currentContentStore: ContentStoreData,
  removeCount = 0
) => {
  const state = prepareBranchMutationState(chats, chatIndex, currentContentStore);
  const { tree, contentStore } = state;
  const existingId = tree.activePath[messageIndex];

  state.chat.messages[messageIndex] = message;
  if (existingId) setMessageAttributes(tree, existingId, message);

  if (existingId) {
    const oldHash = tree.nodes[existingId].contentHash;
    // See upsertMessageAtIndexState for delta-on-edit rationale
    const newHash = addContentDelta(contentStore, message.content, oldHash);
    releaseContent(contentStore, oldHash);
    tree.nodes[existingId] = {
      ...tree.nodes[existingId],
      role: message.role,
      contentHash: newHash,
    };
  } else if (messageIndex === tree.activePath.length) {
    const parentId =
      messageIndex === 0 ? null : tree.activePath[messageIndex - 1] ?? null;
    const newId = uuidv4();
    tree.nodes[newId] = {
      id: newId,
      parentId,
      role: message.role,
      contentHash: addContent(contentStore, message.content),
      createdAt: Date.now(),
    };
    setMessageAttributes(tree, newId, message);
    tree.activePath.push(newId);
  }

  for (let removed = 0; removed < removeCount; removed += 1) {
    removeMessageAtIndexFromPreparedState(state, messageIndex + 1);
  }

  return finalizePreparedBranchMutationState(state);
};

export const truncateActivePathState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeId: string,
  contentStore: ContentStoreData
) => {
  const updatedChats = cloneChatAt(chats, chatIndex);
  captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
  const tree = updatedChats[chatIndex].branchTree!;
  const idx = tree.activePath.indexOf(nodeId);
  if (idx >= 0) {
    tree.activePath = tree.activePath.slice(0, idx + 1);
    updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
  }
  return updatedChats;
};

export const copyBranchSequenceState = (
  chats: ChatInterface[],
  chatIndex: number,
  fromNodeId: string,
  toNodeId: string
): BranchClipboard | null => {
  const tree = chats[chatIndex]?.branchTree;
  if (!tree?.nodes[fromNodeId] || !tree.nodes[toNodeId]) return null;

  // Walk from toNodeId up to fromNodeId to build the path
  const nodeIds: string[] = [];
  let cur: string | null = toNodeId;
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur) || !tree.nodes[cur]) return null;
    visited.add(cur);
    nodeIds.unshift(cur);
    if (cur === fromNodeId) break;
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  // Verify we actually reached fromNodeId
  if (nodeIds[0] !== fromNodeId) return null;
  const nodes: Record<string, BranchNode> = {};
  nodeIds.forEach((id) => {
    nodes[id] = { ...tree.nodes[id] };
  });

  const clipboard: BranchClipboard = { nodeIds, sourceChat: chats[chatIndex].id, nodes };
  for (const id of nodeIds) copyMessageAttributes(tree, id, clipboard, id);
  return clipboard;
};

export const removeBranchSequenceState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeIds: string[],
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  const chat = updatedChats[chatIndex];
  const tree = chat.branchTree!;
  const removed = new Set(nodeIds);
  for (const node of Object.values(tree.nodes)) {
    if (removed.has(node.id) || !node.parentId || !removed.has(node.parentId)) continue;
    let parentId: string | null = node.parentId;
    while (parentId && removed.has(parentId)) parentId = tree.nodes[parentId].parentId;
    tree.nodes[node.id] = { ...node, parentId };
  }
  for (const id of nodeIds) {
    releaseContent(contentStore, tree.nodes[id].contentHash);
    deleteMessageAttributes(tree, id);
    delete tree.nodes[id];
  }
  tree.activePath = tree.activePath.filter((id) => !removed.has(id));
  if (tree.activePath.length === 0) {
    const root = Object.values(tree.nodes).find((node) => !node.parentId);
    if (root) tree.activePath = buildPathToLeaf(tree, root.id);
  }
  tree.rootId = tree.activePath[0] ?? '';
  chat.messages = materializeActivePath(tree, contentStore);
  return { chats: updatedChats, contentStore };
};

export const pasteBranchSequenceState = (
  chats: ChatInterface[],
  targetChatIndex: number,
  afterNodeId: string,
  clipboard: BranchClipboard,
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, targetChatIndex);
  const tree = updatedChats[targetChatIndex].branchTree!;

  const idMap: Record<string, string> = {};
  clipboard.nodeIds.forEach((id) => {
    idMap[id] = uuidv4();
  });

  let prevId = afterNodeId;
  for (const origId of clipboard.nodeIds) {
    const newId = idMap[origId];
    const srcNode = clipboard.nodes[origId];
    retainContent(contentStore, srcNode.contentHash);
    tree.nodes[newId] = {
      ...srcNode,
      id: newId,
      parentId: prevId,
      createdAt: Date.now(),
    };
    copyMessageAttributes(clipboard, origId, tree, newId);
    prevId = newId;
  }

  const destinationPath = buildPathToLeaf(tree, afterNodeId);
  const insertIdx = destinationPath.indexOf(afterNodeId);
  tree.activePath = [
    ...destinationPath.slice(0, insertIdx + 1),
    ...clipboard.nodeIds.map((id) => idMap[id]),
  ];
  tree.rootId = tree.activePath[0] ?? '';
  updatedChats[targetChatIndex].messages = materializeActivePath(tree, contentStore);

  return { chats: updatedChats, contentStore };
};

/**
 * Update a branch node's role in place.
 * Precondition: chats[chatIndex].branchTree must already exist
 * (caller must run ensureBranchTreeState first).
 */
export const updateNodeRoleState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeId: string,
  role: Role,
  contentStore: ContentStoreData
) => {
  const updatedChats = cloneChatAt(chats, chatIndex);
  const chat = updatedChats[chatIndex];
  captureProjectedMessageAttributes(chat, contentStore);
  const tree = chat.branchTree!;
  const prevRole = tree.nodes[nodeId]?.role;
  tree.nodes[nodeId] = { ...tree.nodes[nodeId], role };

  // Sync config.systemPrompt when index-0 node role changes
  const isTopNode = tree.activePath[0] === nodeId;
  if (isTopNode) {
    if (prevRole === 'system' && role !== 'system') {
      // Changing away from system → clear config
      chat.config = { ...chat.config, systemPrompt: undefined };
    } else if (prevRole !== 'system' && role === 'system') {
      // Changing to system → populate config from content
      syncBubbleToConfig(chat, tree, contentStore);
    }
  }

  chat.messages = materializeActivePath(tree, contentStore);
  return updatedChats;
};

export type UpsertWithAutoBranchResult = {
  chats: ChatInterface[];
  contentStore: ContentStoreData;
  newId?: string;
  noOp?: boolean;
};

/**
 * Upsert a message in place; branching is an explicit operation.
 *
 * - No content/role change → no-op (returns noOp: true)
 * - Role-only change → in-place role update
 * - Content change → in-place update, preserving the existing path
 */
export const upsertWithAutoBranchState = (
  chats: ChatInterface[],
  chatIndex: number,
  messageIndex: number,
  message: MessageInterface,
  currentContentStore: ContentStoreData
): UpsertWithAutoBranchResult => {
  const { chats: ensuredChats, contentStore: ensuredStore } =
    ensureBranchReadyState(chats, chatIndex, currentContentStore);
  const tree = ensuredChats[chatIndex].branchTree!;
  const existingId = tree.activePath[messageIndex];

  if (!existingId) {
    return upsertMessageAtIndexState(
      ensuredChats, chatIndex, messageIndex, message, ensuredStore
    );
  }

  const node = tree.nodes[existingId];
  const contentChanged = !isContentEqual(ensuredStore, node.contentHash, message.content);
  const roleChanged = node.role !== message.role;

  const previousAttributes = JSON.stringify(tree.messageAttributesV1);
  setMessageAttributes(tree, existingId, message);
  const attributesChanged = JSON.stringify(tree.messageAttributesV1) !== previousAttributes;

  // Complete no-op: no change to tree or contentStore, skip undo history
  if (!contentChanged && !roleChanged && !attributesChanged) {
    return { chats: ensuredChats, contentStore: ensuredStore, noOp: true };
  }

  if (!contentChanged && !roleChanged) return { chats: ensuredChats, contentStore: ensuredStore };

  // Role-only change: in-place update
  if (!contentChanged) {
    return { chats: updateNodeRoleState(ensuredChats, chatIndex, existingId, message.role, ensuredStore), contentStore: ensuredStore };
  }

  // Content changed: always in-place update (overwrite semantics)
  return upsertMessageAtIndexState(
    ensuredChats, chatIndex, messageIndex, message, ensuredStore
  );
};

export const resolveNodeTarget = (chats: ChatInterface[] | undefined, input: { chatId: string; nodeId: string }, activeOnly = false) => {
  const chatIndex = chats?.findIndex((chat) => chat.id === input.chatId) ?? -1;
  const chat = chats?.[chatIndex];
  if (!chat) return { status: 'chat-missing' as const };
  const index = chat.branchTree
    ? chat.branchTree.activePath.indexOf(input.nodeId)
    : Number(input.nodeId);
  const exists = chat.branchTree ? !!chat.branchTree.nodes[input.nodeId]
    : Number.isInteger(index) && index >= 0 && String(index) === input.nodeId && !!chat.messages[index];
  if (!exists) return { status: 'node-missing' as const };
  if (activeOnly && index < 0) return { status: 'invalid-target' as const };
  return { status: 'valid' as const, chatIndex, messageIndex: index, chat };
};

export const setNodeDisplayFieldState = (
  chats: ChatInterface[] | undefined, input: { chatId: string; nodeId: string },
  field: 'label' | 'starred' | 'pinned', value: string | true | undefined, contentStore: ContentStoreData
) => {
  const target = resolveNodeTarget(chats, input);
  if (target.status !== 'valid') return target;
  const ensured = ensureBranchTreeState(chats!, target.chatIndex, contentStore);
  const nodeId = target.chat.branchTree ? input.nodeId : ensured.chats[target.chatIndex].branchTree!.activePath[target.messageIndex];
  if (ensured.chats[target.chatIndex].branchTree!.nodes[nodeId][field] === value) return { status: 'unchanged' as const };
  return { status: 'updated' as const, chats: setBranchNodeFieldState(ensured.chats, target.chatIndex, nodeId, field, value),
    contentStore: ensured.contentStore, nodeId, historyBase: ensured };
};

export const insertNodeState = (
  chats: ChatInterface[] | undefined,
  input: { chatId: string; beforeNodeId: string | null; role: Role; content: ContentInterface[] },
  contentStore: ContentStoreData
) => {
  const chatIndex = chats?.findIndex(chat => chat.id === input.chatId) ?? -1;
  if (chatIndex < 0) return { status: 'chat-missing' as const };
  const target = input.beforeNodeId === null ? null : resolveNodeTarget(chats, { chatId: input.chatId, nodeId: input.beforeNodeId }, true);
  if (target && target.status !== 'valid') return target;
  const index = target?.messageIndex ?? chats![chatIndex].messages.length;
  const ensured = ensureBranchTreeState(chats!, chatIndex, contentStore);
  const result = insertMessageAtIndexState(ensured.chats, chatIndex, index, { role: input.role, content: input.content }, ensured.contentStore);
  return { status: 'updated' as const, ...result, nodeId: result.newId, historyBase: ensured };
};

export const removeNodeState = (
  chats: ChatInterface[] | undefined, input: { chatId: string; nodeId: string }, contentStore: ContentStoreData,
  options?: { preserveNode?: boolean }
) => {
  const target = resolveNodeTarget(chats, input, true);
  if (target.status !== 'valid') return target;
  if ((target.chat.protectedNodes ?? {})[input.nodeId]) return { status: 'protected' as const };
  const ensured = ensureBranchReadyState(chats!, target.chatIndex, contentStore);
  const result = removeMessageAtIndexState(ensured.chats, target.chatIndex, target.messageIndex, ensured.contentStore, options);
  return { status: 'updated' as const, ...result, historyBase: ensured };
};
