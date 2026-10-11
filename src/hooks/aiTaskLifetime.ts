import useStore from '@store/store';
import type { StoreState } from '@store/store';

type TaskKind = 'generation' | 'evaluation-pre' | 'evaluation-post' | 'title';
export interface AiTaskTicket {
  requestId: string;
  chatId: string;
  nodeId?: string;
  parent?: AiTaskTicket;
  status: 'active' | 'completed' | 'cancelled';
  dependencyIds: string[];
  fingerprint: string;
  kind: TaskKind;
  cancel?: () => void;
}
const tasks = new Map<string, AiTaskTicket>();
const targetKey = (ticket: Pick<AiTaskTicket, 'kind' | 'chatId' | 'nodeId'>) => JSON.stringify([ticket.kind, ticket.chatId, ticket.nodeId]);

function fingerprint(ticket: AiTaskTicket, state: StoreState): string | null {
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

// Register against the same synchronous state used to prepare the request.
export function beginAiTask(input: Omit<AiTaskTicket, 'status' | 'fingerprint'>): AiTaskTicket {
  const ticket: AiTaskTicket = { ...input, status: 'active', fingerprint: '' };
  const key = targetKey(ticket);
  const previous = tasks.get(key);
  if (previous) cancelAiTask(previous);
  ticket.fingerprint = fingerprint(ticket, useStore.getState()) ?? '';
  tasks.set(key, ticket);
  return ticket;
}

export function ownsAiTask(ticket: AiTaskTicket): boolean {
  return ticket.status === 'active' && tasks.get(targetKey(ticket)) === ticket;
}

export function isAiTaskCurrent(ticket: AiTaskTicket): boolean {
  return ticket.status === 'active' && ticket.parent?.status !== 'cancelled'
    && tasks.get(targetKey(ticket)) === ticket && ticket.fingerprint !== ''
    && fingerprint(ticket, useStore.getState()) === ticket.fingerprint;
}

export function finishAiTask(ticket: AiTaskTicket): void {
  if (ticket.status === 'active') ticket.status = 'completed';
  if (tasks.get(targetKey(ticket)) === ticket) tasks.delete(targetKey(ticket));
}

export function cancelAiTask(ticket: AiTaskTicket, notify = true): void {
  if (ticket.status !== 'active') return;
  ticket.status = 'cancelled';
  if (tasks.get(targetKey(ticket)) === ticket) tasks.delete(targetKey(ticket));
  if (notify) ticket.cancel?.();
  for (const child of [...tasks.values()]) if (child.parent === ticket) cancelAiTask(child);
}

export function invalidateAiTasks(chatIds?: readonly string[], nodeIds?: readonly string[]): void {
  for (const ticket of [...tasks.values()]) {
    if (chatIds && !chatIds.includes(ticket.chatId)) continue;
    if (nodeIds && !nodeIds.some(id => id === ticket.nodeId || ticket.dependencyIds.includes(id))) continue;
    cancelAiTask(ticket);
  }
}

export function evaluationDependencyIds(chatId: string, nodeId: string, phase: 'pre-send' | 'post-receive'): string[] {
  const tree = useStore.getState().chats?.find(chat => chat.id === chatId)?.branchTree;
  const ids = phase === 'post-receive' ? [nodeId] : [];
  let node = tree?.nodes[nodeId];
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.role === 'user') { ids.push(node.id); break; }
    node = node.parentId ? tree?.nodes[node.parentId] : undefined;
  }
  return ids;
}

export function cancelAiTaskRequest(requestId: string): void {
  for (const ticket of [...tasks.values()]) if (ticket.requestId === requestId) cancelAiTask(ticket, false);
}
