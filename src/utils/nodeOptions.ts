import type { ChatInterface } from '@type/chat';

export type NodeMapField = 'collapsedNodes' | 'omittedNodes' | 'protectedNodes' | 'summaryTargets';

/** Produce a new chats array with updated node-map field for one chat. */
export const updateChatNodeField = (
  chats: ChatInterface[],
  chatIndex: number,
  field: NodeMapField,
  value: Record<string, boolean>
): ChatInterface[] => {
  const updated = chats.slice();
  updated[chatIndex] = { ...updated[chatIndex], [field]: value };
  return updated;
};

export const setChatNodeMapState = (
  chats: ChatInterface[] | undefined, input: { chatId: string; nodeId?: string; value: boolean }, field: NodeMapField
) => {
  const index = chats?.findIndex(chat => chat.id === input.chatId) ?? -1;
  const chat = chats?.[index];
  if (!chat) return { status: 'missing' as const };
  if (input.nodeId !== undefined && !(chat.branchTree ? chat.branchTree.nodes[input.nodeId]
    : String(Number(input.nodeId)) === input.nodeId && Number(input.nodeId) >= 0 && chat.messages[Number(input.nodeId)])) return { status: 'missing' as const };
  const previous = chat[field] ?? {};
  const next = input.nodeId !== undefined ? { ...previous } : {};
  if (input.nodeId !== undefined) {
    if (!!previous[input.nodeId] === input.value) return { status: 'unchanged' as const };
    if (input.value) next[input.nodeId] = true;
    else delete next[input.nodeId];
  } else if (input.value) {
    for (const id of chat.branchTree?.activePath ?? chat.messages.map((_, index) => String(index))) next[id] = true;
  }
  if (Object.keys(previous).length === Object.keys(next).length && Object.keys(next).every(id => previous[id] === next[id])) return { status: 'unchanged' as const };
  return { status: 'updated' as const, chats: updateChatNodeField(chats!, index, field, next), chatIndex: index, map: next };
};
