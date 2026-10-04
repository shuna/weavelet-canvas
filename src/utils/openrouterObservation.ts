import useStore from '@store/store';
import type { OpenRouterObservation } from '@type/chat';

export function recordOpenRouterObservation(chatId: string, nodeId: string, patch: OpenRouterObservation): void {
  if (!Object.keys(patch).length) return;
  const state = useStore.getState();
  const index = state.chats?.findIndex(c => c.id === chatId) ?? -1;
  const chat = state.chats?.[index];
  const tree = chat?.branchTree;
  const node = tree?.nodes[nodeId];
  if (!chat || !tree || !node || !state.chats) return;
  const chats = state.chats.slice();
  chats[index] = { ...chat, branchTree: { ...tree, nodes: { ...tree.nodes, [nodeId]: {
    ...node, openRouterObservation: { ...node.openRouterObservation, ...patch },
  } } } };
  state.setChats(chats);
}
