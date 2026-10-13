import { insertAssistantPlaceholder, prepareRegenerateState, prepareContinueState, finalizeGenerationState, resolveAssistantPrefillKey } from '../../src/utils/generationPlan';
import { ensureBranchTreeState, switchActivePathState } from '../../src/store/branch-domain';
import { materializeActivePath } from '../../src/utils/branchUtils';
import { resolveContent, type ContentStoreData } from '../../src/utils/contentStore';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { withEditingRuntime } from './editing';
import type { BranchEditCapture, BranchHistoryState } from '../../src/utils/branchHistory';
import type { ChatInterface, ContentInterface } from '../../src/types/chat';

type Plan = { targetNodeId:string; messageIndex:number; activePath:string[]; requestPath:string[]; prefillKey:string };
type Input = {operation:'prepare'|'finalize';chat:ChatInterface;contentStore:ContentStoreData;viewingPath:string[];
  action?:'append'|'regenerate'|'continue';nodeID?:string;parts?:ContentInterface[];plan?:Plan;newIDs?:string[];now:number};
export function generationPlan(json:string,capture?:BranchEditCapture):string {
  const input=JSON.parse(json) as Input;
  const before={chat:input.chat,contentStore:input.contentStore};
  const isolated=structuredClone(before);
  if(!Array.isArray(isolated.chat.messages)&&isolated.chat.branchTree)isolated.chat.messages=materializeActivePath(isolated.chat.branchTree,isolated.contentStore,true);
  const run=()=>{
    let state={chats:[isolated.chat],contentStore:isolated.contentStore};
    const wasFlat=!isolated.chat.branchTree;
    if(input.operation==='prepare'&&!wasFlat){
      state=ensureBranchTreeState(state.chats,0,state.contentStore);
      if(input.viewingPath.some(id=>!Object.hasOwn(state.chats[0].branchTree!.nodes,id)))throw Error('Invalid viewing path.');
      state.chats=switchActivePathState(state.chats,0,input.viewingPath,state.contentStore);
    }
    let plan=input.plan;
    if(input.operation==='prepare'){
      let mode:'append'|'midchat'='append',index:number|null=null;
      if(input.action==='regenerate'||input.action==='continue'){
        if(input.nodeID===undefined)throw Error('Missing generation target.');
        const nodeId=wasFlat&&input.nodeID.startsWith('message-')?input.nodeID.slice(8):input.nodeID;
        const target={chatId:isolated.chat.id,nodeId};
        const result=input.action==='regenerate'?prepareRegenerateState(state.chats,target,state.contentStore):prepareContinueState(state.chats,{...target,content:input.parts},state.contentStore);
        if(result.status!=='updated')return JSON.stringify({status:result.status,changes:[],...('blockedNodeIds'in result?{blockedNodeIds:result.blockedNodeIds}:{} )});
        if('historyBase'in result)capture?.(result.historyBase as BranchHistoryState,result);
        state={chats:result.chats,contentStore:result.contentStore};mode=result.submitMode;index=result.insertIndex;
      }else if(input.action!=='append')throw Error('Invalid generation action.');
      const prefillKey=resolveAssistantPrefillKey(state.chats[0],mode,index);
      const prepared=insertAssistantPlaceholder(state.chats,0,mode,state.contentStore,index);
      state={chats:prepared.updatedChats,contentStore:prepared.contentStore};
      const activePath=state.chats[0].branchTree!.activePath;
      plan={targetNodeId:prepared.targetNodeId,messageIndex:prepared.messageIndex,activePath:[...activePath],requestPath:activePath.slice(0,prepared.messageIndex),prefillKey};
    }else if(input.operation==='finalize'){
      if(!plan||!Array.isArray(input.parts))throw Error('Missing generation result.');
      // No stream output leaves Web's original empty placeholder untouched.
      if(input.parts.length){
        const result=finalizeGenerationState(state.chats,0,plan.targetNodeId,input.parts,state.contentStore);
        if(result.status!=='updated')return JSON.stringify({status:result.status,changes:[]});
        state={chats:result.chats,contentStore:result.contentStore};
      }
    }else throw Error('Invalid generation operation.');
    for(const [hash,entry]of Object.entries(state.contentStore))if(entry.delta&&JSON.stringify(entry.delta)!==JSON.stringify(before.contentStore[hash]?.delta)){
      const content=resolveContent(state.contentStore,hash);const {delta:_delta,...full}=entry;state.contentStore[hash]={...full,content};
    }
    const chat=state.chats[0];
    if(chat.branchTree)chat.messages=materializeActivePath(chat.branchTree,state.contentStore,true);
    return JSON.stringify({status:'updated',plan,changes:diffJSONChanges(before,JSON.parse(JSON.stringify({chat,contentStore:state.contentStore})))});
  };
  if(input.newIDs!==undefined)return withEditingRuntime(input.newIDs,Object.keys(isolated.chat.branchTree?.nodes??{}),input.now,run);
  const clock=Date.now;Date.now=()=>input.now;try{return run();}finally{Date.now=clock;}
}
