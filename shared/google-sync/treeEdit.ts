import { moveNodeState, replaceNodeAndPruneState, deleteNodeBranchState, switchActivePathState } from '../../src/store/branch-domain';
import { textValueOf, replaceTextValue } from '../../src/utils/messageText';
import { materializeActivePath } from '../../src/utils/branchUtils';
import { resolveContent, type ContentStoreData } from '../../src/utils/contentStore';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { withEditingRuntime } from './editing';
import type { ChatInterface, ContentInterface, Role } from '../../src/types/chat';
import type { BranchEditCapture } from '../../src/utils/branchHistory';

type Input = {chat:ChatInterface;contentStore:ContentStoreData;nodeID:string;viewingPath:string[];newIDs:string[];now:number;
  operation:'move'|'replaceAndPrune'|'deleteBranch';direction?:'up'|'down';role?:Role;parts?:ContentInterface[];removeCount?:number;editedText?:string};
export function treeEdit(json:string,capture?:BranchEditCapture):string {
  const input = JSON.parse(json) as Input;
  const before = {chat:input.chat,contentStore:input.contentStore};
  const isolated = structuredClone(before);
  if (!Array.isArray(isolated.chat.messages) && isolated.chat.branchTree) isolated.chat.messages = materializeActivePath(isolated.chat.branchTree,isolated.contentStore);
  const nodeId = !isolated.chat.branchTree && input.nodeID.startsWith('message-') ? input.nodeID.slice(8) : input.nodeID;
  return withEditingRuntime(input.newIDs,Object.keys(isolated.chat.branchTree?.nodes ?? {}),input.now,()=>{
    let chats = [isolated.chat];
    if (isolated.chat.branchTree) {
      if (input.viewingPath.some(id=>!Object.hasOwn(isolated.chat.branchTree!.nodes,id))) throw new Error('Invalid viewing path.');
      // Capture original redundant attributes before selecting another branch.
      chats = switchActivePathState(chats,0,input.viewingPath,isolated.contentStore);
    }
    const target = {chatId:isolated.chat.id,nodeId};
    let result;
    switch(input.operation) {
      case 'move':
        if (input.direction !== 'up' && input.direction !== 'down') throw new Error('Invalid move direction.');
        result = moveNodeState(chats,{...target,direction:input.direction},isolated.contentStore);break;
      case 'replaceAndPrune':
        if (!['user','assistant','system'].includes(input.role!) || !Array.isArray(input.parts)) throw new Error('Invalid replacement message.');
        if (input.editedText !== undefined && typeof input.editedText !== 'string') throw new Error('Invalid text.');
        const parts = input.editedText !== undefined && input.editedText !== textValueOf(input.parts) ? replaceTextValue(input.parts,input.editedText) : input.parts;
        result = replaceNodeAndPruneState(chats,{...target,role:input.role!,content:parts,removeCount:input.removeCount!},isolated.contentStore);break;
      case 'deleteBranch': result = deleteNodeBranchState(chats,target,isolated.contentStore);break;
      default: throw new Error('Invalid tree operation.');
    }
    if (result.status !== 'updated') return JSON.stringify({...result,changes:[]});
    // New projected DMP patches must resolve before restoring native opaque values.
    for (const [hash,entry] of Object.entries(result.contentStore)) {
      if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
        const content = resolveContent(result.contentStore,hash), {delta:_delta,...full} = entry;
        result.contentStore[hash] = {...full,content};
      }
    }
    const chat = result.chats[0];
    if (chat.branchTree) chat.messages = materializeActivePath(chat.branchTree,result.contentStore,true);
    capture?.(result.historyBase,result);
    return JSON.stringify({status:result.status,
      ...('removedNodeIds' in result ? {removedNodeIds:result.removedNodeIds} : {}),
      ...('pruneBlockedBy' in result ? {pruneBlockedBy:result.pruneBlockedBy} : {}),
      changes:diffJSONChanges(before,JSON.parse(JSON.stringify({chat,contentStore:result.contentStore})))});
  });
}
