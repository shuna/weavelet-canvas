import useStore from '@store/store';
import { buildPathToLeaf, getSiblingsOf } from '@utils/branchUtils';

export default function useBranchNavigation(chatIndex: number, nodeId?: string) {
  const chat = useStore((state) => state.chats?.[chatIndex]);
  const tree = chat?.branchTree;
  const siblings = tree && nodeId ? getSiblingsOf(tree, nodeId) : [];
  const currentIdx = siblings.findIndex((node) => node.id === nodeId);

  const switchTo = (targetNodeId: string) => {
    const state = useStore.getState();
    const currentChat = state.chats?.[chatIndex];
    if (!currentChat?.branchTree || !currentChat.branchTree.nodes[targetNodeId]) return;
    state.pushNavigationEntry({
      chatId: currentChat.id,
      activePath: buildPathToLeaf(currentChat.branchTree, targetNodeId),
      viewContext: state.chatActiveView,
      source: 'branch-switch',
    });
    state.switchBranchAtNode(chatIndex, targetNodeId);
  };

  return { siblings, currentIdx, switchTo };
}
