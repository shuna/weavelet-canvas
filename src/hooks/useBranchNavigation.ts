import useStore from '@store/store';
import { getSiblingsOf } from '@utils/branchUtils';

export default function useBranchNavigation(chatIndex: number, nodeId?: string) {
  const chat = useStore((state) => state.chats?.[chatIndex]);
  const tree = chat?.branchTree;
  const siblings = tree && nodeId ? getSiblingsOf(tree, nodeId) : [];
  const currentIdx = siblings.findIndex((node) => node.id === nodeId);

  const switchTo = (targetNodeId: string) => {
    const state = useStore.getState();
    if (!chat) return;
    state.navigateToNode({ chatId: chat.id, nodeId: targetNodeId, source: 'branch-switch', history: 'push', focus: 'none' });
  };

  return { siblings, currentIdx, switchTo };
}
