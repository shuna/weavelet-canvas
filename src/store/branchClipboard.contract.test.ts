import {describe,expect,it,vi} from 'vitest';
vi.mock('@utils/showToast',()=>({showToast:vi.fn()}));vi.mock('uuid',()=>({v4:()=>editingUUID()}));
import {editingUUID,withEditingRuntime} from '../../shared/google-sync/editing';
import {branchClipboard} from '../../shared/google-sync/branchClipboard';
import {branchHistory} from '../../shared/google-sync/branchHistory';
import {materializeActivePath} from '../utils/branchUtils';
import {flushPendingGC,resolveContent,addContentDelta,addContent} from '../utils/contentStore';
import {collectReferencedHashes} from './storage/IndexedDbStorage';
import {toRecords,fromRecords} from './storage/google/records';
import {createBranchSlice} from './branch-slice';import {createChatSlice} from './chat-slice';
import type {StoreState} from './store';import type {StoreApi} from 'zustand';
function source(flat=false){
 const contentStore:any={};const chats:any[]=[];
 for(const [chatID,ids] of [['source',['root','middle','last','hidden']],['target',['target-root','target-last']]] as const){
  const nodes:any={};for(let index=0;index<ids.length;index++){const id=ids[index];nodes[id]={id,parentId:index===0?null:ids[index===3?1:index-1],role:'user',contentHash:id,createdAt:1,xNode:{opaqueRef:2}};contentStore[id]={content:[{type:'text',text:id,xPart:{opaqueRef:3}},{type:'text',text:'second'}],refCount:1,xEntry:{opaqueRef:4}};}
  const tree:any={nodes,rootId:ids[0],activePath:[...ids.slice(0,3)],xTree:{opaqueRef:5},messageAttributesV1:{version:1,byNode:chatID==='source'?{middle:{xMessage:{opaqueRef:6}}}:{}}};
  const chat:any={id:chatID,title:chatID,config:{model:'fake'},titleSet:true,imageDetail:'auto',branchTree:tree,messages:materializeActivePath(tree,contentStore,true),xChat:{opaqueRef:7}};
  if(chatID==='source'){chat.collapsedNodes={middle:true};chat.omittedNodes={middle:true,last:false};chat.protectedNodes={};}
  chats.push(chat);
 }
 if(flat){delete chats[0].branchTree;delete chats[1].branchTree;return {chats,contentStore:{},clipboard:null};}
 return {chats,contentStore,clipboard:null};
}
function apply(source:any,changes:any[]){const root=JSON.parse(JSON.stringify(source));for(const c of changes){let parent=root;for(const k of c.path.slice(0,-1))parent=parent[k];const key=c.path.at(-1);if(c.op==='set')parent[key]=c.value;else if(c.op==='remove'){if(Array.isArray(parent))parent.splice(key,1);else delete parent[key];}else{const object=c.path.length?parent[key]:root,entries=c.keys.map((key:string)=>[key,object[key]]);Object.keys(object).forEach(key=>delete object[key]);Object.assign(object,Object.fromEntries(entries));}}return root;}
const input=(data:any,operation:string,extra:any={})=>({...data,operation,sourceChatId:'source',fromNodeId:'middle',toNodeId:'last',targetChatId:'target',afterNodeId:'target-root',newIDs:['copy-middle','copy-last'],now:10,...extra});
const run=(data:any)=>JSON.parse(branchClipboard(JSON.stringify(data)));
function store(source:any){let state:StoreState;const get=()=>state;const set=((partial:any)=>{state={...state,...(typeof partial==='function'?partial(state):partial)};}) as StoreApi<StoreState>['setState'];state={...createChatSlice(set,get),...createBranchSlice(set,get),chats:source.chats,contentStore:source.contentStore,branchClipboard:source.clipboard} as StoreState;return get;}
describe('shared branch clipboard operations',()=>{
 it('copies only selected nodes/maps/attributes and leaves other chats and body store unchanged; actual Web caller shares this rule',()=>{
  const initial=source(),before=structuredClone(initial);const result=run(input(initial,'copy')),changed=apply(initial,result.changes);
  expect(result.status).toBe('copied');expect(changed.clipboard.nodeIds).toEqual(['middle','last']);expect(Object.keys(changed.clipboard.nodes)).toEqual(['middle','last']);expect(changed.clipboard.messageAttributesV1.byNode.middle).toEqual({xMessage:{opaqueRef:6}});
  expect(changed.clipboard.collapsedNodes).toEqual({middle:true});expect(changed.clipboard.omittedNodes).toEqual({middle:true,last:false});expect(changed.contentStore).toEqual(initial.contentStore);expect(changed.chats).toEqual(initial.chats);expect(initial).toEqual(before);
  const get=store(initial);expect(get().copyBranchSequence({chatId:'source',fromNodeId:'middle',toNodeId:'last'})).toEqual({status:'copied'});expect(get().branchClipboard).toEqual(changed.clipboard);expect(get().branchHistoryPast).toEqual([]);
 });
 it('pastes a new branch with node order, metadata, flags and unknown clipboard attrs retained; keeps the old suffix',()=>{
  const initial=source();initial.chats[0].protectedNodes={middle:true};const copied=apply(initial,run(input(initial,'copy')).changes);copied.clipboard.xClipboard={opaqueRef:55};
  const result=run(input(copied,'paste')),changed=apply(copied,result.changes);
  expect(result.nodeIds).toEqual(['copy-middle','copy-last']);expect(result.affectedChatIds).toEqual(['target']);expect(changed.chats[1].branchTree.activePath).toEqual(['target-root','copy-middle','copy-last']);expect(Object.keys(changed.chats[1].branchTree.nodes)).toEqual(['target-root','target-last','copy-middle','copy-last']);
  expect(changed.chats[1].branchTree.nodes['target-last']).toEqual(initial.chats[1].branchTree.nodes['target-last']);expect(changed.chats[1].messages[1].xMessage).toEqual({opaqueRef:6});expect(changed.chats[1].collapsedNodes).toEqual({'copy-middle':true});expect(changed.chats[1].omittedNodes).toEqual({'copy-middle':true,'copy-last':false});expect(changed.chats[1].protectedNodes).toEqual({'copy-middle':true});expect(changed.clipboard).toEqual(copied.clipboard);expect(changed.chats[0]).toEqual(initial.chats[0]);expect(changed.contentStore.middle.refCount).toBe(2);expect(copied.contentStore.middle.refCount).toBe(1);
 });
 it('cuts then saves with actual GC protection, restarts, and pastes without losing body/delta/metadata',()=>{
  const initial=source();const text='long body '.repeat(300);initial.contentStore.middle.content=[{type:'text',text,xPart:{opaqueRef:3}}];
  const base=addContent(initial.contentStore,[{type:'text',text:'base '.repeat(300)}]);const delta=addContentDelta(initial.contentStore,[{type:'text',text:'base '.repeat(300)+'edit'}],base);initial.chats[0].branchTree.nodes.last.contentHash=delta;delete initial.contentStore.last;initial.chats[0].messages=materializeActivePath(initial.chats[0].branchTree,initial.contentStore,true);
  const cut=run(input(initial,'cut')),changed=apply(initial,cut.changes);expect(changed.chats[0].branchTree.activePath).toEqual(['root']);expect(changed.chats[0].branchTree.nodes.hidden.parentId).toBe('root');
  const protectedHashes=collectReferencedHashes(changed.chats,changed.clipboard);expect(protectedHashes.has('middle')).toBe(true);expect(protectedHashes.has(delta)).toBe(true);flushPendingGC(changed.contentStore,protectedHashes);
  const restarted=JSON.parse(JSON.stringify(changed)),pasted=apply(restarted,run(input(restarted,'paste')).changes);expect(pasted.chats[1].messages[1].content).toEqual(initial.contentStore.middle.content);expect(pasted.chats[1].messages[2].content).toEqual(resolveContent(initial.contentStore,delta));expect(pasted.contentStore.middle.xEntry).toEqual({opaqueRef:4});
 });
 it('moves between chats atomically, records both chats and supports one global undo',()=>{
  const initial=source(),result=JSON.parse(branchHistory(JSON.stringify({operation:'edit',kind:'branchClipboard',input:input(initial,'move')}))),changed=apply(initial,result.changes);
  expect(result.status).toBe('moved');expect(result.affectedChatIds).toEqual(['source','target']);expect(result.history.past[0].chats.map((chat:any)=>chat.id)).toEqual(['source','target']);expect(changed.chats[0].branchTree.activePath).toEqual(['root']);expect(changed.chats[1].branchTree.activePath).toEqual(['target-root','copy-middle','copy-last']);
  const undo=JSON.parse(branchHistory(JSON.stringify({operation:'undo',history:result.history,chats:changed.chats,contentStore:changed.contentStore}))),restored=apply({chats:changed.chats,contentStore:changed.contentStore},undo.changes);
  expect(restored.chats[0].messages).toEqual(initial.chats[0].messages);expect(restored.chats[1].messages).toEqual(initial.chats[1].messages);
  const get=store(initial);expect(withEditingRuntime(['copy-middle','copy-last'],Object.keys(initial.chats[0].branchTree.nodes),10,()=>get().moveBranchSequence({sourceChatId:'source',fromNodeId:'middle',toNodeId:'last',targetChatId:'target',afterNodeId:'target-root'})).status).toBe('moved');expect(get().branchHistoryPast[0].chats.map(chat=>chat.id)).toEqual(['source','target']);expect(initial.contentStore.middle.refCount).toBe(1);
 });
 it('rejects cut/move selected protection, cycles/not-ancestor, targets inside selection, missing clipboard/content before publication',()=>{
  const initial=source();initial.chats[0].protectedNodes={last:true};for(const operation of ['cut','move'])expect(run(input(initial,operation))).toEqual({status:'protected',blockedNodeIds:['last'],changes:[]});
  expect(run(input(initial,'copy',{fromNodeId:'hidden',toNodeId:'last'})).status).toBe('not-ancestor');expect(run(input(initial,'paste'))).toEqual({status:'clipboard-empty',changes:[]});
  initial.chats[0].protectedNodes={};expect(run(input(initial,'move',{targetChatId:'source',afterNodeId:'middle'})).status).toBe('invalid-target');
  const copied=apply(initial,run(input(initial,'copy')).changes);delete copied.contentStore.middle;expect(run(input(copied,'paste')).status).toBe('content-missing');copied.contentStore.middle={content:[],refCount:1,delta:{baseHash:'middle',patch:'fake'}};expect(run(input(copied,'paste')).status).toBe('content-missing');
 });
 it('supports flat copy/paste through the same one-time Web ensure and keeps numeric flags on new node IDs',()=>{
  const initial=source(true);initial.chats[0].collapsedNodes={'1':true};initial.chats[0].omittedNodes={'1':true};initial.chats[0].protectedNodes={'1':true};
  const copied=apply(initial,run(input(initial,'copy',{fromNodeId:'1',toNodeId:'2',newIDs:['flat-r','flat-m','flat-l']})).changes);
  expect(copied.clipboard.nodeIds).toEqual(['flat-m','flat-l']);expect(copied.clipboard.protectedNodes).toEqual({'flat-m':true});expect(copied.chats[1]).toEqual(initial.chats[1]);
  const pasted=apply(copied,run(input(copied,'paste',{afterNodeId:'0',newIDs:['target-flat-r','target-flat-l','copy-middle','copy-last']})).changes);expect(pasted.chats[1].branchTree.activePath).toEqual(['target-flat-r','copy-middle','copy-last']);expect(pasted.chats[1].omittedNodes).toEqual({'copy-middle':true});expect(pasted.chats[1].protectedNodes).toEqual({'copy-middle':true});
  expect(run(input(initial,'cut',{fromNodeId:'1',toNodeId:'2',newIDs:[]}))).toEqual({status:'protected',blockedNodeIds:['1'],changes:[]});
 });
 it('keeps legacy clipboard defaults and imported unknown clipboard fields through Google record roundtrip',async()=>{
  const initial=source(),copied=apply(initial,run(input(initial,'copy')).changes);copied.clipboard.xClipboard={ordered:['x','y'],largeFake:{opaqueRef:500}};
  const restored=await fromRecords(await toRecords({version:18,state:{chats:copied.chats,contentStore:copied.contentStore,branchClipboard:copied.clipboard}}));
  expect(restored.state.branchClipboard?.collapsedNodes).toEqual({middle:true});expect(restored.state.branchClipboard?.omittedNodes).toEqual({middle:true,last:false});expect((restored.state.branchClipboard as any).xClipboard).toEqual(copied.clipboard.xClipboard);
  const legacy=structuredClone(copied);delete legacy.clipboard.collapsedNodes;delete legacy.clipboard.omittedNodes;delete legacy.clipboard.protectedNodes;const pasted=apply(legacy,run(input(legacy,'paste')).changes);expect(pasted.chats[1].collapsedNodes).toBeUndefined();expect(pasted.chats[1].omittedNodes).toBeUndefined();
 });
});
