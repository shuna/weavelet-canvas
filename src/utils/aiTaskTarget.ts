import type { StoreState } from '@store/store';

export type AiTaskTarget = {
  kind: 'generation' | 'recovery' | 'evaluation-pre' | 'evaluation-post' | 'title';
  chatId: string;
  nodeId?: string;
  dependencyIds: string[];
};

// Actual Web task dependencies; host task ownership and cancellation stay outside this function.
export function aiTaskFingerprint(ticket: AiTaskTarget, state: Pick<StoreState, 'chats'>): string | null {
  const chat = state.chats?.find(chat => chat.id === ticket.chatId);
  if (!chat || (ticket.nodeId && !chat.branchTree?.nodes[ticket.nodeId])) return null;
  if (ticket.kind === 'title') return JSON.stringify([chat.title, chat.titleSet]);
  const nodes = ticket.dependencyIds.map(id => {
    const node = chat.branchTree?.nodes[id];
    return node ? [id, node.role, node.contentHash, chat.omittedNodes?.[id] ?? false] : null;
  });
  if (nodes.some(node => node === null)) return null;
  return JSON.stringify([nodes, ticket.kind === 'generation' ? chat.config : null]);
}
