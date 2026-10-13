import {describe,expect,it,vi} from 'vitest';
vi.mock('@utils/showToast',()=>({showToast:vi.fn()}));
vi.mock('uuid',()=>({v4:()=>editingUUID()}));
import {editingUUID,withEditingRuntime} from '../../shared/google-sync/editing';
import {treeEdit} from '../../shared/google-sync/treeEdit';
import {branchHistory} from '../../shared/google-sync/branchHistory';
import {materializeActivePath} from '../utils/branchUtils';
import {resolveContent,computeContentHash} from '../utils/contentStore';
import {createBranchSlice} from './branch-slice';
import {createChatSlice} from './chat-slice';
import type {StoreState} from './store';
import type {StoreApi} from 'zustand';
function source(flat=false){
 const nodes:any={},contentStore:any={};
 for(const [id,parentId,role] of [['root',null,'user'],['mid','root','assistant'],['last','mid','user'],['hidden','mid','assistant'],['leaf','hidden','user']]){
  nodes[id!]={id,parentId,role,contentHash:id,createdAt:1,xNode:{opaqueRef:2}};
  contentStore[id!]={content:[{type:'text',text:id,xPart:{opaqueRef:3}}],refCount:1,xEntry:{opaqueRef:4}};
 }
 nodes.hidden.pinned=true;
 const branchTree:any={nodes,rootId:'root',activePath:['root','mid','last'],xTree:{opaqueRef:5},messageAttributesV1:{version:1,byNode:{mid:{xMessage:{opaqueRef:6}}}}};
 const chat:any={id:'chat',title:'title',titleSet:true,imageDetail:'auto',config:{model:'fake'},branchTree,messages:materializeActivePath(branchTree,contentStore,true),xChat:{opaqueRef:7},collapsedNodes:{mid:true}};
 if(flat){delete chat.branchTree;return {chat,contentStore:{}};}
 return {chat,contentStore};
}
function apply(source:any,changes:any[]){const root=JSON.parse(JSON.stringify(source));for(const c of changes){let parent=root;for(const k of c.path.slice(0,-1))parent=parent[k];const key=c.path.at(-1);if(c.op==='set')parent[key]=c.value;else if(c.op==='remove'){if(Array.isArray(parent))parent.splice(key,1);else delete parent[key];}else{const object=c.path.length?parent[key]:root,entries=c.keys.map((key:string)=>[key,object[key]]);Object.keys(object).forEach(key=>delete object[key]);Object.assign(object,Object.fromEntries(entries));}}return root;}
const input=(state:any,operation:string,nodeID:string,extra:any={})=>({...state,operation,nodeID,viewingPath:state.chat.branchTree?.activePath??[],newIDs:['flat-root','flat-mid','flat-last'],now:10,...extra});
const run=(data:any)=>JSON.parse(treeEdit(JSON.stringify(data)));
function store(source:any){let state:StoreState;const get=()=>state;const set=((partial:any)=>{state={...state,...(typeof partial==='function'?partial(state):partial)};}) as StoreApi<StoreState>['setState'];state={...createChatSlice(set,get),...createBranchSlice(set,get),chats:[source.chat],contentStore:source.contentStore} as StoreState;return get;}
describe('shared remaining tree operations',()=>{
 it('moves nodes in actual Web and bridge with matching path/parents, preserving metadata/order/input',()=>{
  const initial=source(),before=structuredClone(initial),data=input(initial,'move','mid',{direction:'up'});
  const result=run(data),changed=apply(initial,result.changes);
  expect(changed.chat.branchTree.activePath).toEqual(['mid','root','last']);expect(changed.chat.branchTree.rootId).toBe('mid');
  expect(changed.chat.branchTree.nodes.mid.parentId).toBeNull();expect(changed.chat.branchTree.nodes.root.parentId).toBe('mid');expect(changed.chat.branchTree.nodes.last.parentId).toBe('root');
  expect(Object.keys(changed.chat.branchTree.nodes)).toEqual(Object.keys(initial.chat.branchTree.nodes));expect(changed.contentStore).toEqual(initial.contentStore);expect(changed.chat.messages[0].xMessage).toEqual({opaqueRef:6});expect(initial).toEqual(before);
  const get=store(initial);expect(withEditingRuntime([],Object.keys(initial.chat.branchTree.nodes),10,()=>get().moveNode({chatId:'chat',nodeId:'mid',direction:'up'})).status).toBe('updated');
  const expectedTree=structuredClone(changed.chat.branchTree);for(const id of ['root','mid','last']) expectedTree.nodes[id].updatedAt=10;expect(get().chats![0].branchTree).toEqual(expectedTree);
 });
 it('keeps endpoint/system moves and invalid/nonactive targets unchanged without flat conversion',()=>{
  const flat=source(true);expect(run(input(flat,'move','0',{direction:'up',newIDs:[]}))).toEqual({status:'unchanged',changes:[]});
  const system=source();system.chat.branchTree.nodes.root.role='system';system.chat.messages=materializeActivePath(system.chat.branchTree,system.contentStore,true);
  expect(run(input(system,'move','mid',{direction:'up'})).status).toBe('unchanged');expect(run(input(system,'move','root',{direction:'down'})).status).toBe('unchanged');
  expect(run(input(source(),'move','hidden',{direction:'up'})).status).toBe('invalid-target');expect(run(input(source(),'move','absent',{direction:'up'})).status).toBe('node-missing');
 });
 it('moves flat nodes after one conversion and captures the actual converted base',()=>{
  const initial=source(true),data=input(initial,'move','1',{direction:'down'});const result=JSON.parse(branchHistory(JSON.stringify({operation:'edit',kind:'treeEdit',input:data})));
  const changed=apply(initial,result.changes);expect(changed.chat.branchTree.activePath).toEqual(['flat-root','flat-last','flat-mid']);expect(changed.chat.branchTree.messageAttributesV1.byNode['flat-mid']).toEqual({xMessage:{opaqueRef:6}});
  expect(result.history.past[0].chats[0].branchTree.activePath).toEqual(['flat-root','flat-mid','flat-last']);
  const undo=JSON.parse(branchHistory(JSON.stringify({operation:'undo',history:result.history,chats:[changed.chat],contentStore:changed.contentStore})));
  expect(apply({chats:[changed.chat],contentStore:changed.contentStore},undo.changes).chats[0].messages).toEqual(initial.chat.messages);
 });
 it('replaces a message and removes only requested following messages; keeps hidden children/unknown attributes and refcounts immutable',()=>{
  const initial=source(),before=structuredClone(initial),data=input(initial,'replaceAndPrune','mid',{role:'user',parts:[{type:'text',text:'replacement',xPart:{opaqueRef:30}}],removeCount:1});
  const result=run(data),changed=apply(initial,result.changes);
  expect(result.removedNodeIds).toEqual(['last']);expect(result.pruneBlockedBy).toEqual([]);expect(changed.chat.branchTree.activePath).toEqual(['root','mid']);expect(changed.chat.branchTree.nodes.hidden).toEqual(initial.chat.branchTree.nodes.hidden);
  expect(changed.chat.messages[1]).toEqual({role:'user',content:data.parts,xMessage:{opaqueRef:6}});expect(changed.chat.branchTree.nodes.mid.xNode).toEqual({opaqueRef:2});expect(initial).toEqual(before);
  const get=store(initial);expect(withEditingRuntime([],Object.keys(initial.chat.branchTree.nodes),10,()=>get().replaceNodeAndPrune({chatId:'chat',nodeId:'mid',role:'user',content:data.parts,removeCount:1}))).toMatchObject({status:'updated',removedNodeIds:['last'],pruneBlockedBy:[]});
  const expectedTree=structuredClone(changed.chat.branchTree);expectedTree.nodes.mid.updatedAt=10;expect(get().chats![0].branchTree).toEqual(expectedTree);
 });
 it('updates content but refuses the entire following prune range if any following node is protected',()=>{
  const initial=source();initial.chat.protectedNodes={last:true};const data=input(initial,'replaceAndPrune','mid',{role:'assistant',parts:[{type:'text',text:'replacement'}],removeCount:9});const result=run(data),changed=apply(initial,result.changes);
  expect(result).toMatchObject({status:'updated',removedNodeIds:[],pruneBlockedBy:['last']});expect(changed.chat.branchTree.nodes.last).toEqual(initial.chat.branchTree.nodes.last);expect(changed.chat.messages[1].xMessage).toEqual({opaqueRef:6});
  expect(run({...data,removeCount:-1})).toEqual({status:'invalid-input',removedNodeIds:[],pruneBlockedBy:[],changes:[]});expect(run({...data,nodeID:'hidden'}).status).toBe('missing');
 });
 it('rejects a protected replacement target before allocating flat IDs or publishing history',()=>{
  const initial=source(true);initial.chat.protectedNodes={'1':true};const before=structuredClone(initial);
  const data=input(initial,'replaceAndPrune','1',{role:'assistant',parts:[{type:'text',text:'edited'}],removeCount:1,newIDs:[]});
  expect(run(data)).toEqual({status:'protected',blockedNodeIds:['1'],removedNodeIds:[],pruneBlockedBy:[],changes:[]});
  const get=store(initial);expect(get().replaceNodeAndPrune({chatId:'chat',nodeId:'1',role:'assistant',content:data.parts,removeCount:1}).status).toBe('protected');expect(get().branchHistoryPast).toEqual([]);expect(initial).toEqual(before);
 });
 it('uses shared text editing rules, retaining empty/second text parts and unknown attributes',()=>{
  const initial=source();initial.contentStore.mid.content=[{type:'text',text:'',first:{opaqueRef:10}},{type:'text',text:'second',second:{opaqueRef:11}}];initial.chat.messages=materializeActivePath(initial.chat.branchTree,initial.contentStore,true);
  const result=run(input(initial,'replaceAndPrune','mid',{role:'assistant',parts:initial.contentStore.mid.content,editedText:'edited',removeCount:0}));
  expect(apply(initial,result.changes).chat.messages[1].content).toEqual([{type:'text',text:'edited',first:{opaqueRef:10}},{type:'text',text:'second',second:{opaqueRef:11}}]);
 });
 it('deletes a hidden pinned subtree, rejects protected descendants before any mutation/history, and fixes empty root',()=>{
  const initial=source(),result=run(input(initial,'deleteBranch','hidden')),changed=apply(initial,result.changes);
  expect(result.removedNodeIds).toEqual(['hidden','leaf']);expect(changed.chat.branchTree.activePath).toEqual(initial.chat.branchTree.activePath);expect(Object.keys(changed.chat.branchTree.nodes)).toEqual(['root','mid','last']);
  initial.chat.protectedNodes={leaf:true};const get=store(initial),before=structuredClone(initial);
  expect(get().deleteBranch(0,'hidden')).toEqual({status:'protected',blockedNodeIds:['leaf']});expect(get().branchHistoryPast).toEqual([]);expect(get().contentStore).toEqual(before.contentStore);
  const blocked=JSON.parse(branchHistory(JSON.stringify({operation:'edit',kind:'treeEdit',input:input(initial,'deleteBranch','mid')})));expect(blocked).toMatchObject({status:'protected',blockedNodeIds:['leaf'],changes:[],history:{past:[],future:[]}});expect(initial).toEqual(before);
  const empty=apply(source(),run(input(source(),'deleteBranch','root')).changes);expect(empty.chat.branchTree.rootId).toBe('');expect(empty.chat.messages).toEqual([]);
 });
 it('deletes a flat suffix using numeric protection maps before allocating IDs',()=>{
  const initial=source(true);initial.chat.protectedNodes={'2':true};expect(run(input(initial,'deleteBranch','1',{newIDs:[]}))).toEqual({status:'protected',blockedNodeIds:['2'],changes:[]});
  delete initial.chat.protectedNodes;const result=run(input(initial,'deleteBranch','1'));expect(result.removedNodeIds).toEqual(['flat-mid','flat-last']);expect(apply(initial,result.changes).chat.messages).toEqual([initial.chat.messages[0]]);
 });
 it('keeps reused content entries immutable when the actual Web caller converts a flat chat',()=>{
  const initial=source(true),hash=computeContentHash(initial.chat.messages[0].content);
  initial.contentStore[hash]={content:initial.chat.messages[0].content,refCount:1,xEntry:{opaqueRef:55}};
  const original=structuredClone(initial.contentStore),get=store(initial);
  expect(withEditingRuntime(['flat-root','flat-mid','flat-last'],[],10,()=>get().moveNode({chatId:'chat',nodeId:'1',direction:'down'})).status).toBe('updated');
  expect(initial.contentStore).toEqual(original);expect(get().contentStore[hash].refCount).toBe(2);expect((get().contentStore[hash] as any).xEntry).toEqual({opaqueRef:55});
 });
 it('expands newly produced projected deltas and keeps unknown part values through resolution',()=>{
  const initial=source();const text='long text '.repeat(300);initial.contentStore.mid.content=[{type:'text',text,xPart:{opaqueRef:3}}];initial.contentStore.mid.refCount=2;initial.chat.messages=materializeActivePath(initial.chat.branchTree,initial.contentStore,true);
  const data=input(initial,'replaceAndPrune','mid',{role:'assistant',parts:[{type:'text',text:text+'changed',xPart:{opaqueRef:3}}],removeCount:0}),changed=apply(initial,run(data).changes),hash=changed.chat.branchTree.nodes.mid.contentHash;
  expect(changed.contentStore[hash].delta).toBeUndefined();expect(resolveContent(changed.contentStore,hash)).toEqual(data.parts);expect(initial.contentStore.mid.refCount).toBe(2);
 });
});
