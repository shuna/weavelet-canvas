import {prepareImportData,buildPreviewAppendPatch,importDefaults,validatePreviewSource,validateImportSelection,type ImportPreviewSource,type ImportDecisions,type Translator} from '../../src/utils/fileImport';
import {importOpaquePaths} from '../../src/utils/fileImportProjection';
import {diffJSONChanges} from '../../src/utils/jsonChanges';
import {withEditingRuntime} from './editing';
import type {StoreState} from '../../src/store/store';
export function fileImport(json:string):string {
 const input=JSON.parse(json);
 const t:Translator=(key,opts)=>String(input.messages?.[key]??opts?.defaultValue??key).replace(/\{\{(\w+)\}\}/g,(_,name)=>String(opts?.[name]??''));
 if(input.operation==='defaults')return JSON.stringify(importDefaults());
 if(input.operation==='inspect'){
  if(!['data','state','source'].includes(input.kind))throw new Error('Invalid import projection kind.');
  const data=input.data,contentStorePaths:(string|number)[][]=[];
  if(data&&typeof data==='object'&&!Array.isArray(data)){
   if(data.contentStore&&typeof data.contentStore==='object')contentStorePaths.push(['contentStore']);
   if(data.state?.contentStore&&typeof data.state.contentStore==='object')contentStorePaths.push(['state','contentStore']);
  }
  return JSON.stringify({opaquePaths:importOpaquePaths(data),contentStorePaths});
 }
 const run=()=>{
  if(input.operation==='preview'){const source=input.source as ImportPreviewSource;return {...source.extensions,version:3,chats:source.chats,folders:source.folders,contentStore:source.contentStore,evaluationResults:source.evaluationResults,...(source.evaluationSettings?{evaluationSettings:source.evaluationSettings}:{})};}
  if(input.operation==='prepare'){
   const prepared=prepareImportData(input.data,input.defaults??importDefaults(),t,input.decisions as ImportDecisions,undefined,input.allowEmpty===true);
   if(prepared.status!=='ready')return prepared;
   const source=prepared.source;return {...prepared,previewV3:{...source.extensions,version:3,chats:source.chats,folders:source.folders,contentStore:source.contentStore,evaluationResults:source.evaluationResults,...(source.evaluationSettings?{evaluationSettings:source.evaluationSettings}:{})}};
  }
  if(input.operation!=='plan')throw new Error('Invalid import operation.');
  if(input.mode!=='append'&&input.mode!=='replace')throw new Error('Invalid import mode.');
  const base=input.base as StoreState,source=input.source as ImportPreviewSource;
  validatePreviewSource(source);
  const ids=input.selectedChatIds??source.chats.map(chat=>chat.id),folders=input.selectedFolderIds??Object.keys(source.folders);
  let data:Record<string,unknown>,currentChatIndex:number;
  if(input.mode==='append'){
   const patch=buildPreviewAppendPatch(base,source,ids,t,{fileName:input.fileName??'',selectedFolderIds:folders},false,input.currentChatId);
   const {currentChatIndex:index,...rest}=patch;data={...base,...rest};currentChatIndex=index;
  }else{
   // The same selection helper validates missing bodies and folder ancestor closure.
   const empty={...base,chats:[],folders:{},contentStore:{},branchClipboard:null,evaluationResults:{}} as StoreState;
   const options={fileName:input.fileName??'',selectedFolderIds:folders};
   if(ids.length||folders.length)validateImportSelection(source,ids,t,options);
   const complete=ids.length===source.chats.length&&folders.length===Object.keys(source.folders).length;
   const selected=complete?undefined:buildPreviewAppendPatch(empty,source,ids,t,options);
   data=complete?{...base,chats:structuredClone(source.chats),folders:structuredClone(source.folders),contentStore:structuredClone(source.contentStore),evaluationResults:structuredClone(source.evaluationResults),branchClipboard:null}:
     {...base,chats:selected!.chats,folders:selected!.folders,contentStore:selected!.contentStore,evaluationResults:selected!.evaluationResults,branchClipboard:null};
   currentChatIndex=ids.length?0:-1;
   if(input.includeSettings&&source.evaluationSettings)data.evaluationSettings={...input.defaults?.evaluationSettings??importDefaults().evaluationSettings,...source.evaluationSettings};
  }
  const persisted=JSON.parse(JSON.stringify(data));
  return {result:{success:true,message:t('notifications.successfulImport',{ns:'import'})},changes:diffJSONChanges(base,persisted),currentChatIndex,
   extensionChanges:diffJSONChanges(input.baseExtensions??{},JSON.parse(JSON.stringify({...input.baseExtensions,...source.extensions})))};
 };
 const existingIDs=[...input.base?.chats??[],...input.source?.chats??[]].flatMap((chat:any)=>[chat.id,...Object.keys(chat.branchTree?.nodes??{})]);
 if(input.newIDs!==undefined)return JSON.stringify(withEditingRuntime(input.newIDs,existingIDs,input.now??Date.now(),run));
 const clock=Date.now;if(input.now!==undefined)Date.now=()=>input.now;
 try{return JSON.stringify(run());}finally{Date.now=clock;}
}
