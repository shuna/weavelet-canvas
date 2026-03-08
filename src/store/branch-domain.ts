import {
  BranchClipboard,
  BranchNode,
  ChatInterface,
  ContentInterface,
  Role,
} from '@type/chat';
import {
  buildPathToLeaf,
  collectDescendants,
  flatMessagesToBranchTree,
  getChildrenOf,
  materializeActivePath,
} from '@utils/branchUtils';
import {
  ContentStoreData,
  addContent,
  releaseContent,
  retainContent,
} from '@utils/contentStore';
import { v4 as uuidv4 } from 'uuid';

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
        }
      : undefined,
    collapsedNodes: chat.collapsedNodes
      ? { ...chat.collapsedNodes }
      : undefined,
  };
  return result;
};

const cloneNode = (node: BranchNode): BranchNode => ({ ...node });

export const ensureBranchTreeState = (
  chats: ChatInterface[],
  chatIndex: number,
  currentContentStore: ContentStoreData
) => {
  if (chats[chatIndex]?.branchTree) {
    return { chats, contentStore: currentContentStore };
  }

  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  updatedChats[chatIndex].branchTree = flatMessagesToBranchTree(
    updatedChats[chatIndex].messages,
    contentStore
  );

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
  const tree = updatedChats[chatIndex].branchTree!;
  const fromNode = tree.nodes[fromNodeId];

  const newId = uuidv4();
  const contentHash = newContent
    ? addContent(contentStore, newContent)
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

  const fromIdx = tree.activePath.indexOf(fromNodeId);
  tree.activePath = [...tree.activePath.slice(0, fromIdx), newId];
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
  const tree = updatedChats[chatIndex].branchTree!;
  const toDelete = collectDescendants(tree, nodeId);
  const parentId = tree.nodes[nodeId]?.parentId;

  toDelete.forEach((id) => {
    releaseContent(contentStore, tree.nodes[id].contentHash);
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

export const renameBranchNodeState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeId: string,
  label: string
) => {
  const updatedChats = cloneChatAt(chats, chatIndex);
  const tree = updatedChats[chatIndex].branchTree!;
  tree.nodes[nodeId] = cloneNode(tree.nodes[nodeId]);
  tree.nodes[nodeId].label = label;
  return updatedChats;
};

export const appendNodeToActivePathState = (
  chats: ChatInterface[],
  chatIndex: number,
  role: Role,
  content: ContentInterface[],
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  const tree = updatedChats[chatIndex].branchTree!;
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
  updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);

  return { chats: updatedChats, contentStore, newId };
};

export const updateLastNodeContentState = (
  chats: ChatInterface[],
  chatIndex: number,
  content: ContentInterface[],
  currentContentStore: ContentStoreData
) => {
  const contentStore = { ...currentContentStore };
  const updatedChats = cloneChatAt(chats, chatIndex);
  const tree = updatedChats[chatIndex].branchTree!;
  const lastId = tree.activePath[tree.activePath.length - 1];

  if (lastId) {
    releaseContent(contentStore, tree.nodes[lastId].contentHash);
    tree.nodes[lastId] = cloneNode(tree.nodes[lastId]);
    tree.nodes[lastId].contentHash = addContent(contentStore, content);
    updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
  }

  return { chats: updatedChats, contentStore };
};

export const truncateActivePathState = (
  chats: ChatInterface[],
  chatIndex: number,
  nodeId: string,
  contentStore: ContentStoreData
) => {
  const updatedChats = cloneChatAt(chats, chatIndex);
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
  const tree = chats[chatIndex].branchTree!;
  const path = tree.activePath;
  const fromIdx = path.indexOf(fromNodeId);
  const toIdx = path.indexOf(toNodeId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) return null;

  const nodeIds = path.slice(fromIdx, toIdx + 1);
  const nodes: Record<string, BranchNode> = {};
  nodeIds.forEach((id) => {
    nodes[id] = { ...tree.nodes[id] };
  });

  return {
    nodeIds,
    sourceChat: chats[chatIndex].id,
    nodes,
  };
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
    prevId = newId;
  }

  const insertIdx = tree.activePath.indexOf(afterNodeId);
  tree.activePath = [
    ...tree.activePath.slice(0, insertIdx + 1),
    ...clipboard.nodeIds.map((id) => idMap[id]),
  ];
  updatedChats[targetChatIndex].messages = materializeActivePath(tree, contentStore);

  return { chats: updatedChats, contentStore };
};
