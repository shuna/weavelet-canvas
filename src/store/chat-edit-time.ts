import type { BranchNode, ChatInterface } from '@type/chat';

const nodeContent = (node: BranchNode) => [node.parentId, node.role, node.contentHash, node.label, node.starred, node.pinned];
const chatContent = (chat: ChatInterface) => [chat.title, chat.folder, chat.config, chat.imageDetail, chat.titleSet,
  chat.omittedNodes, chat.protectedNodes, chat.branchTree ? undefined : chat.messages];

export function recordChatEdits(previous: ChatInterface[] | undefined, next: ChatInterface[], now: number) {
  const byId = new Map(previous?.map(chat => [chat.id, chat]));
  let changed = (previous?.length ?? 0) !== next.length;
  const chats = next.map(chat => {
    const before = byId.get(chat.id);
    if (chat === before) return chat;
    let edited = !before || JSON.stringify(chatContent(chat)) !== JSON.stringify(chatContent(before));
    let tree = chat.branchTree;
    if (tree && tree !== before?.branchTree) {
      const nodes = { ...tree.nodes };
      let nodesEdited = Object.keys(nodes).length !== Object.keys(before?.branchTree?.nodes ?? {}).length;
      for (const [id, node] of Object.entries(nodes)) {
        const old = before?.branchTree?.nodes[id];
        if (!old || (node !== old && JSON.stringify(nodeContent(node)) !== JSON.stringify(nodeContent(old)))) {
          nodes[id] = { ...node, updatedAt: !old ? node.updatedAt ?? now : now };
          nodesEdited = true;
        }
      }
      if (nodesEdited) tree = { ...tree, nodes };
      edited ||= nodesEdited;
    } else if (before?.branchTree && !tree) edited = true;
    if (!edited) return chat;
    changed = true;
    return { ...chat, branchTree: tree, updatedAt: !before ? chat.updatedAt ?? now : now };
  });
  return { chats, changed };
}
