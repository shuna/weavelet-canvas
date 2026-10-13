import type { BranchClipboard, ChatInterface } from '../types/chat';
import type { ContentStoreData } from '../utils/contentStore';
import {getStreamingTargetFromHash,peekBufferedContent} from '../utils/streamingBuffer';
import {copyBranchSequenceState,removeBranchSequenceState,pasteBranchSequenceState,ensureBranchTreeState,resolveNodeTarget} from './branch-domain';
export type SequenceRange = {chatId:string;fromNodeId:string;toNodeId:string};
export type SequenceFailure = {status:'missing'|'not-ancestor'|'invalid-target'|'content-missing'|'clipboard-empty'|'protected';blockedNodeIds?:string[]};
export const hasClipboardContent = (clipboard:BranchClipboard,store:ContentStoreData) => clipboard.nodeIds.length>0 && clipboard.nodeIds.every(id=>{
  const node=clipboard.nodes[id];if(!node)return false;
  const target=getStreamingTargetFromHash(node.contentHash);
  if(target)return peekBufferedContent(target.chatId,target.nodeId)!==undefined;
  let hash:string|undefined=node.contentHash;const visited=new Set<string>();
  while(hash){if(visited.has(hash)||!store[hash])return false;visited.add(hash);hash=store[hash].delta?.baseHash;}
  return true;
});
export const validateSequenceRange = (chats:ChatInterface[]|undefined,input:SequenceRange) => {
  const from=resolveNodeTarget(chats,{chatId:input.chatId,nodeId:input.fromNodeId});
  const to=resolveNodeTarget(chats,{chatId:input.chatId,nodeId:input.toNodeId});
  if(from.status!=='valid'||to.status!=='valid')return {status:'missing' as const};
  if(!from.chat.branchTree){
    if(from.messageIndex>to.messageIndex)return {status:'not-ancestor' as const};
    return {status:'valid' as const,chatIndex:from.chatIndex,nodeIds:from.chat.messages.slice(from.messageIndex,to.messageIndex+1).map((_,index)=>String(from.messageIndex+index))};
  }
  const clipboard=copyBranchSequenceState(chats!,from.chatIndex,input.fromNodeId,input.toNodeId);
  return clipboard ? {status:'valid' as const,chatIndex:from.chatIndex,nodeIds:clipboard.nodeIds} : {status:'not-ancestor' as const};
};
export type ClipboardOperation = {operation:'copy'|'cut'|'paste'|'move';sourceChatId?:string;fromNodeId?:string;toNodeId?:string;targetChatId?:string;afterNodeId?:string};
export function branchClipboardState(chats:ChatInterface[]|undefined,contentStore:ContentStoreData,clipboard:BranchClipboard|null,input:ClipboardOperation){
  let prepared={chats:chats!,contentStore};
  let sourceIndex=-1,fromIndex=-1,toIndex=-1,rangeIds:string[]=[];
  if(input.operation!=='paste'){
    const range=validateSequenceRange(chats,{chatId:input.sourceChatId!,fromNodeId:input.fromNodeId!,toNodeId:input.toNodeId!});
    if(range.status!=='valid')return range;
    sourceIndex=range.chatIndex;rangeIds=range.nodeIds;
    if(input.operation!=='copy'){
      const blockedNodeIds=rangeIds.filter(id=>chats![sourceIndex].protectedNodes?.[id]);
      if(blockedNodeIds.length)return {status:'protected' as const,blockedNodeIds};
    }
    if(!chats![sourceIndex].branchTree){fromIndex=Number(input.fromNodeId);toIndex=Number(input.toNodeId);}
  }
  const target=input.operation==='paste'||input.operation==='move' ? resolveNodeTarget(chats,{chatId:input.targetChatId!,nodeId:input.afterNodeId!}) : undefined;
  if(target&&target.status!=='valid')return {status:'missing' as const};
  if(input.operation==='move'&&target?.status==='valid'&&sourceIndex===target.chatIndex&&rangeIds.includes(input.afterNodeId!))return {status:'invalid-target' as const};
  if(input.operation==='paste'){
    if(!clipboard)return {status:'clipboard-empty' as const};
    if(!hasClipboardContent(clipboard,contentStore))return {status:'content-missing' as const};
  }
  if(sourceIndex>=0){
    prepared=ensureBranchTreeState(prepared.chats,sourceIndex,prepared.contentStore);
    const tree=prepared.chats[sourceIndex].branchTree!;
    clipboard=copyBranchSequenceState(prepared.chats,sourceIndex,fromIndex>=0?tree.activePath[fromIndex]:input.fromNodeId!,toIndex>=0?tree.activePath[toIndex]:input.toNodeId!)!;
    if(input.operation!=='copy'&&!hasClipboardContent(clipboard,prepared.contentStore))return {status:'content-missing' as const};
  }
  let afterNodeId=input.afterNodeId!;
  if(target?.status==='valid'){
    prepared=ensureBranchTreeState(prepared.chats,target.chatIndex,prepared.contentStore);
    if(!target.chat.branchTree)afterNodeId=prepared.chats[target.chatIndex].branchTree!.activePath[target.messageIndex];
  }
  const historyBase=prepared;
  if(input.operation==='copy')return {status:'copied' as const,...prepared,clipboard:clipboard!};
  let result=prepared;
  if(input.operation==='cut'||input.operation==='move')result=removeBranchSequenceState(result.chats,sourceIndex,clipboard!.nodeIds,result.contentStore);
  if(input.operation==='paste'||input.operation==='move')result=pasteBranchSequenceState(result.chats,(target as Extract<typeof target,{status:'valid'}>).chatIndex,afterNodeId,clipboard!,result.contentStore);
  return {status:input.operation==='cut'?'cut' as const:input.operation==='move'?'moved' as const:'pasted' as const,...result,clipboard:clipboard!,historyBase,
    ...(target?.status==='valid'?{nodeIds:result.chats[target.chatIndex].branchTree!.activePath.slice(-clipboard!.nodeIds.length)}:{})};
}
