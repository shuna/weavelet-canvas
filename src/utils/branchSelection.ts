export type BranchSelectionNode = {chatId: string; nodeId: string};

// Selection order is the graph's node order, as supplied by ReactFlow.
export function resolveBranchSelection(nodes: readonly BranchSelectionNode[]) {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  return {
    range: first && last && nodes.every(node => node.chatId === first.chatId)
      ? {chatId:first.chatId,fromNodeId:first.nodeId,toNodeId:last.nodeId}
      : null,
    pasteTarget: last ? {chatId:last.chatId,afterNodeId:last.nodeId} : null,
  };
}
