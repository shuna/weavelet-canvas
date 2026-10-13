import {branchClipboardState,type ClipboardOperation} from '../../src/store/branch-clipboard';
import {materializeActivePath} from '../../src/utils/branchUtils';
import {resolveContent,type ContentStoreData} from '../../src/utils/contentStore';
import {diffJSONChanges,orderedJSONEqual} from '../../src/utils/jsonChanges';
import {withEditingRuntime} from './editing';
import type {BranchClipboard,ChatInterface} from '../../src/types/chat';
import type {BranchEditCapture} from '../../src/utils/branchHistory';
type Input=ClipboardOperation&{chats:ChatInterface[];contentStore:ContentStoreData;clipboard:BranchClipboard|null;newIDs:string[];now:number};
export function branchClipboard(json:string,capture?:BranchEditCapture):string {
 const input=JSON.parse(json) as Input;
 if(!['copy','cut','paste','move'].includes(input.operation))throw new Error('Invalid clipboard operation.');
 const before={chats:input.chats,contentStore:input.contentStore,clipboard:input.clipboard};
 const isolated=structuredClone(before);
 for(const chat of isolated.chats)if(!Array.isArray(chat.messages)&&chat.branchTree)chat.messages=materializeActivePath(chat.branchTree,isolated.contentStore);
 const result=withEditingRuntime(input.newIDs,isolated.chats.flatMap(chat=>Object.keys(chat.branchTree?.nodes??{})),input.now,()=>branchClipboardState(isolated.chats,isolated.contentStore,isolated.clipboard,input));
 if(!('chats' in result))return JSON.stringify({...result,changes:[]});
 for(const [hash,entry] of Object.entries(result.contentStore))if(entry.delta&&JSON.stringify(entry.delta)!==JSON.stringify(before.contentStore[hash]?.delta)){
   const content=resolveContent(result.contentStore,hash),{delta:_delta,...full}=entry;result.contentStore[hash]={...full,content};
 }
 // Only changed chats leave the native raw document; unrelated projections stay untouched.
 const chats=result.chats.map((chat,index)=>chat!==isolated.chats[index]&&chat.branchTree?{...chat,messages:materializeActivePath(chat.branchTree,result.contentStore,true)}:before.chats[index]);
 if('historyBase' in result)capture?.(result.historyBase,result);
 const affectedChatIds=chats.filter((chat,index)=>!orderedJSONEqual(before.chats[index],chat)).map(chat=>chat.id);
 return JSON.stringify({status:result.status,affectedChatIds,...('nodeIds' in result?{nodeIds:result.nodeIds}:{}),changes:diffJSONChanges(before,JSON.parse(JSON.stringify({chats,contentStore:result.contentStore,clipboard:result.clipboard})))});
}
