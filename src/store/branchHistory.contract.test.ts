import { describe, expect, it, vi } from 'vitest';
vi.mock('@utils/showToast', () => ({showToast:vi.fn()}));
vi.mock('uuid', () => ({v4:()=>editingUUID()}));
import {editingUUID} from '../../shared/google-sync/editing';
import {branchHistory} from '../../shared/google-sync/branchHistory';
import {deleteBranchState} from './branch-domain';
import {captureBranchHistory, stepBranchHistory} from '../utils/branchHistory';
import {flushPendingGC, releaseContent, resolveContent} from '../utils/contentStore';
const call = (input:any)=>JSON.parse(branchHistory(JSON.stringify(input)));
const source = () => ({chat:{id:'a',title:'before',config:{model:'fake',systemPrompt:'system'},titleSet:true,imageDetail:'auto',messages:[{role:'user',content:[{type:'text',text:'before',xPart:{opaqueRef:9}}],xMessage:{opaqueRef:8}}],xChat:{opaqueRef:7}},contentStore:{}});
function apply(source:any,changes:any[]) {
  const root=structuredClone(source);
  for(const change of changes){let parent=root;for(const key of change.path.slice(0,-1))parent=parent[key];const key=change.path.at(-1);
    if(change.op==='set')parent[key]=change.value;
    else if(change.op==='remove'){if(Array.isArray(parent))parent.splice(key,1);else delete parent[key];}
    else {const object=change.path.length?parent[key]:root; const entries=change.keys.map((key:string)=>[key,object[key]]);Object.keys(object).forEach(key=>delete object[key]);Object.assign(object,Object.fromEntries(entries));}}
  return root;
}
function edit(input:any,history:any,mode='overwrite') {return call({operation:'edit',kind:'messageEdit',history,input:{...input,nodeID:'0',viewingPath:[],role:'user',parts:[{type:'text',text:'after',xPart:{opaqueRef:9}}],mode,newIDs:['flat-root','extra'],now:1}});}
describe('shared global branch history',()=>{
 it('captures the actual prepared flat tree once, restores attributes and keeps current metadata/maps',()=>{
  const initial=source(), original=structuredClone(initial); const result=edit(initial,undefined);const changed=apply(initial,result.changes);
  expect(initial).toEqual(original);expect(result.history.past).toHaveLength(1);expect(result.history.past[0].chats[0].branchTree.rootId).toBe('flat-root');
  expect(result.history.past[0].chats[0].branchTree.messageAttributesV1.byNode['flat-root']).toEqual({xMessage:{opaqueRef:8}});
  changed.chat.title='renamed';changed.chat.collapsedNodes={'flat-root':true};changed.chat.config.temperature=.25;
  const undone=call({operation:'undo',history:result.history,chats:[changed.chat],contentStore:changed.contentStore});const restored=apply({chats:[changed.chat],contentStore:changed.contentStore},undone.changes);
  expect(restored.chats[0].messages[0]).toEqual(initial.chat.messages[0]);expect(restored.chats[0].title).toBe('renamed');expect(restored.chats[0].collapsedNodes).toEqual({'flat-root':true});expect(restored.chats[0].xChat).toEqual({opaqueRef:7});
  const redone=call({operation:'redo',history:undone.history,...restored});expect(apply(restored,redone.changes).chats[0].messages[0].content[0].text).toBe('after');expect(redone.can).toEqual({undo:true,redo:false});
 });
 it('excludes map-only/options-noop and records display changes',()=>{
  const input=source();const base={...input,operation:'save',nodeId:'0',newIDs:['root'],now:1,value:{label:'',starred:false,pinned:false,collapsed:true,omitted:false,protected:false}};
  const maps=call({operation:'edit',kind:'nodeOptions',input:base});expect(maps.history.past).toEqual([]);
  const display=call({operation:'edit',kind:'nodeOptions',input:{...base,value:{...base.value,label:'label'}}});expect(display.history.past[0].chats[0].branchTree.rootId).toBe('root');
 });
 it('captures removal through its actual prepared flat base and keeps the global stack across chats',()=>{
  const initial=source(); const first=edit(initial,undefined); const a=apply(initial,first.changes);
  const b=source(); b.chat.id='b';const second=edit(b,first.history);const changedB=apply(b,second.changes);
  const undo=call({operation:'undo',history:second.history,chats:[a.chat,changedB.chat],contentStore:{...a.contentStore,...changedB.contentStore},busyChatIds:['a']});
  expect(undo.status).toBe('updated');expect(undo.affectedChatIds).toEqual(['b']);expect(undo.can.undo).toBe(false);
  const removed=call({operation:'edit',kind:'nodeRemoval',input:{...initial,operation:'remove',nodeID:'0',viewingPath:[],newIDs:['removed-flat'],now:1}});
  expect(removed.history.past[0].chats[0].branchTree.rootId).toBe('removed-flat');
  const empty=apply(initial,removed.changes);const restored=call({operation:'undo',history:removed.history,chats:[empty.chat],contentStore:empty.contentStore});
  expect(apply({chats:[empty.chat],contentStore:empty.contentStore},restored.changes).chats[0].messages[0]).toEqual(initial.chat.messages[0]);
 });
 it('limits global capture to 50 and blocks busy/deleted chats without moving history',()=>{
  let state=source(),history:any;for(let n=0;n<52;n++){const result=edit(state,history);history=result.history;state=apply(state,result.changes);state.chat.messages[0].content[0].text=String(n);delete (state.chat as any).branchTree;}
  expect(history.past).toHaveLength(50);
  const busy=call({operation:'undo',history,chats:[state.chat],contentStore:state.contentStore,busyChatIds:['a']});expect(busy.status).toBe('busy');expect(busy.history).toEqual(history);expect(busy.can.undo).toBe(false);
  expect(call({operation:'undo',history,chats:[],contentStore:{}}).status).toBe('chat-missing');
 });
 it('invalidates only changed messages/tree, preserving metadata-only transitions',()=>{
  const result=edit(source(),undefined), before=[source().chat];const after=structuredClone(before);after[0].title='rename';after[0].config.model='other';
  expect(call({operation:'invalidate',history:result.history,before,after}).history).toEqual(result.history);
  after[0].messages[0].content[0].text='external';expect(call({operation:'invalidate',history:result.history,before,after}).history).toEqual({past:[],future:[]});
 });
 it('deletes a branch without mutating source entries and repairs removed root',()=>{
  const chat:any={...source().chat,messages:[{role:'user',content:[{type:'text',text:'body'}]}],branchTree:{rootId:'r',activePath:['r'],nodes:{r:{id:'r',role:'user',parentId:null,contentHash:'h',createdAt:1}}}};const store:any={h:{content:[{type:'text',text:'body'}],refCount:1,xEntry:{opaqueRef:4}}};const original=structuredClone(store);
  const removed=deleteBranchState([chat],0,'r',store);expect(store).toEqual(original);expect(removed.chats[0].branchTree!.rootId).toBe('');
  const history=captureBranchHistory({past:[],future:[]},{chats:[chat],contentStore:store},removed);const undo=stepBranchHistory(history,removed,'undo',[]);
  expect(undo.status).toBe('updated');expect(undo.state.contentStore.h.refCount).toBe(0);
  expect(flushPendingGC(undo.state.contentStore,new Set(['h']))).toEqual([]);expect(resolveContent(undo.state.contentStore,'h')).toEqual(store.h.content);
  releaseContent(undo.state.contentStore,'h');flushPendingGC(undo.state.contentStore);
 });
});
