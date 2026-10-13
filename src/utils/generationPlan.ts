import type { ChatInterface, ContentInterface, MessageInterface } from '@type/chat';
import { materializeActivePath, resolveRegenerateTarget } from './branchUtils';
import { addContent, releaseContent, type ContentStoreData } from './contentStore';
import { appendNodeToActivePathState, insertMessageAtIndexState, removeNodeState, replaceNodeAndPruneState, resolveNodeTarget, cloneChatAt } from '@store/branch-domain';

type SubmitMode = 'append' | 'midchat';
export const createAssistantPlaceholder = (): MessageInterface => ({
  role: 'assistant',
  content: [{ type: 'text', text: '' }],
});

export const insertAssistantPlaceholder = (
  chats: ChatInterface[],
  chatIndex: number,
  mode: SubmitMode,
  contentStore: ContentStoreData,
  insertIndex: number | null
): {
  updatedChats: ChatInterface[];
  messageIndex: number;
  targetNodeId: string;
  contentStore: ContentStoreData;
} => {
  const assistantMessage = createAssistantPlaceholder();
  const messageIndex =
    mode === 'append' ? chats[chatIndex].messages.length : insertIndex ?? 0;

  if (mode === 'append') {
    const appended = appendNodeToActivePathState(
      chats,
      chatIndex,
      'assistant',
      assistantMessage.content,
      contentStore
    );
    return {
      updatedChats: appended.chats,
      messageIndex,
      targetNodeId: appended.newId,
      contentStore: appended.contentStore,
    };
  }

  const inserted = insertMessageAtIndexState(
    chats,
    chatIndex,
    messageIndex,
    assistantMessage,
    contentStore
  );
  return {
    updatedChats: inserted.chats,
    messageIndex,
    targetNodeId: inserted.newId,
    contentStore: inserted.contentStore,
  };
};

export function prepareRegenerateState(chats: ChatInterface[] | undefined, input: {chatId:string;nodeId:string}, contentStore: ContentStoreData) {
  const target = resolveNodeTarget(chats, input, true);
  if (target.status !== 'valid') return target;
  const plan = resolveRegenerateTarget(target.chat.messages[target.messageIndex].role, target.messageIndex, target.chat.messages.length);
  if (!plan) return {status:'invalid' as const};
  if (plan.removeIndex < 0) return {status:'updated' as const,chats:chats!,contentStore,submitMode:plan.submitMode==='append'?'append' as const:'midchat' as const,insertIndex:plan.insertIndex};
  const removeId = target.chat.branchTree?.activePath[plan.removeIndex] ?? String(plan.removeIndex);
  const result = removeNodeState(chats, {chatId:input.chatId,nodeId:removeId}, contentStore);
  if (result.status !== 'updated') return result.status==='protected'?{...result,blockedNodeIds:[removeId]}:result;
  return {...result,submitMode:plan.submitMode==='append'?'append' as const:'midchat' as const,insertIndex:plan.insertIndex};
}
export function prepareContinueState(chats: ChatInterface[] | undefined, input: {chatId:string;nodeId:string;content?:ContentInterface[]}, contentStore: ContentStoreData) {
  const target = resolveNodeTarget(chats, input, true);
  if (target.status !== 'valid') return target;
  if (target.chat.protectedNodes?.[input.nodeId]) return {status:'protected' as const,blockedNodeIds:[input.nodeId]};
  const nextIndex = target.messageIndex + 1;
  const removeCount = nextIndex < target.chat.messages.length ? 1 : 0;
  const nextId = target.chat.branchTree?.activePath[nextIndex] ?? String(nextIndex);
  if (removeCount && target.chat.protectedNodes?.[nextId]) return {status:'protected' as const,blockedNodeIds:[nextId]};
  const message = target.chat.messages[target.messageIndex];
  const result = replaceNodeAndPruneState(chats, {...input,role:message.role,content:input.content??message.content,removeCount},contentStore);
  if (result.status !== 'updated') return result;
  return {...result,submitMode:'midchat' as const,insertIndex:nextIndex};
}
/** Finalize a generated target; mirrors the Web streaming-buffer publication. */
export function finalizeGenerationState(chats: ChatInterface[],chatIndex:number,targetNodeId:string,content:ContentInterface[],store:ContentStoreData) {
  const chat = chats[chatIndex], node = chat?.branchTree?.nodes[targetNodeId];
  if (!node) return {status:'missing' as const};
  const updatedChats = cloneChatAt(chats,chatIndex);
  const updatedChat = updatedChats[chatIndex], tree = updatedChat.branchTree!;
  const contentStore = Object.fromEntries(Object.entries(store).map(([hash,entry])=>[hash,{...entry}]));
  releaseContent(contentStore,node.contentHash);
  tree.nodes[targetNodeId] = {...tree.nodes[targetNodeId],contentHash:addContent(contentStore,content)};
  if (tree.activePath.includes(targetNodeId)) updatedChat.messages = materializeActivePath(tree,contentStore);
  return {status:'updated' as const,chats:updatedChats,contentStore};
}

export const resolveAssistantPrefillKey = (chat: {branchTree?: {activePath: string[]}}, mode: SubmitMode, insertIndex: number | null): string =>
  mode === 'append' ? '__sticky__' : (chat.branchTree?.activePath[(insertIndex ?? 1) - 1] ?? '__sticky__');
