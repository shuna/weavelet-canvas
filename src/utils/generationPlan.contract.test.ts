import { describe, expect, it, vi } from 'vitest';
vi.mock('uuid',()=>({v4:()=>editingUUID()}));
import { editingUUID, withEditingRuntime } from '../../shared/google-sync/editing';
import { generationPlan } from '../../shared/google-sync/generationPlan';
import { branchHistory } from '../../shared/google-sync/branchHistory';
import { prepareRegenerateState, prepareContinueState, insertAssistantPlaceholder, finalizeGenerationState, retryTarget } from './generationPlan';
import { createBranchSlice } from '../store/branch-slice';
import { resolveContent } from './contentStore';
import { materializeActivePath } from './branchUtils';
import { _defaultChatConfig } from '../constants/chatDefaults';
import type { ChatInterface } from '../types/chat';
const fixture=()=>{
  const contentStore:any=Object.fromEntries(['s','u','a','follow','hidden'].map(id=>[id,{content:[{type:'text',text:id,x:{opaqueRef:1}}],refCount:1}]));
  const nodes:any=Object.fromEntries(['s','u','a','follow','hidden'].map((id,i)=>[id,{id,parentId:i===0?null:id==='hidden'?'u':['s','u','a'][i-1],role:i===0?'system':i===2?'assistant':'user',contentHash:id,xNode:{opaqueRef:2}}]));
  const chat:any={id:'chat',title:'fake',titleSet:true,imageDetail:'auto',config:{..._defaultChatConfig,systemPrompt:'s'},branchTree:{nodes,rootId:'s',activePath:['s','u','a','follow']},xChat:{opaqueRef:3},collapsedNodes:{hidden:true},omittedNodes:{hidden:true},protectedNodes:{}};
  chat.messages=materializeActivePath(chat.branchTree,contentStore,true);return {chat,contentStore};
};
const run=(input:any)=>JSON.parse(generationPlan(JSON.stringify({...input,now:100,viewingPath:input.chat.branchTree?.activePath??[]})));
function apply(before:any,changes:any[]){const result=structuredClone(before);for(const change of changes){let value=result;for(const key of change.path.slice(0,-1))value=value[key];const key=change.path.at(-1);if(change.op==='set')value[key]=change.value;else if(change.op==='remove'){if(Array.isArray(value))value.splice(key,1);else delete value[key];}else{const object=change.path.length?value[key]:result,values={...object};for(const name of Object.keys(object))delete object[name];for(const name of change.keys)object[name]=values[name];}}return result;}
function storeFor(chat:ChatInterface,contentStore:any){let state:any;const set=(value:any)=>{state={...state,...(typeof value==='function'?value(state):value)};};state={...createBranchSlice(set,()=>state),chats:[chat],contentStore,generatingSessions:{},collapsedNodeMaps:{},omittedNodeMaps:{},protectedNodeMaps:{}};return ()=>state;}
describe('shared actual generation preparation/finalization',()=>{
  it('matches actual Web regenerate preparation plus placeholder and leaves input unchanged',()=>{
    const original=fixture(),before=structuredClone(original);
    const get=storeFor(original.chat,original.contentStore);
    const prepared=withEditingRuntime(['generated'],Object.keys(original.chat.branchTree!.nodes),100,()=>{
      const result=get().prepareRegenerateNode({chatId:'chat',nodeId:'a'});
      return insertAssistantPlaceholder(get().chats,0,result.submitMode,get().contentStore,result.insertIndex);
    });
    const result=run({...original,operation:'prepare',action:'regenerate',nodeID:'a',newIDs:['generated']});
    expect(result.plan).toEqual({targetNodeId:'generated',messageIndex:2,activePath:['s','u','generated','follow'],requestPath:['s','u'],prefillKey:'u',submitMode:'midchat',insertIndex:2});
    expect(prepared.updatedChats[0].branchTree!.nodes).not.toHaveProperty('a');
    expect(prepared.updatedChats[0].branchTree!.nodes.follow.parentId).toBe('generated');
    expect(prepared.updatedChats[0].branchTree!.nodes.hidden).toEqual(original.chat.branchTree!.nodes.hidden);
    const restored=apply(original,result.changes);
    expect(restored.chat.branchTree.activePath).toEqual(['s','u','generated','follow']);
    expect(restored.chat.branchTree.nodes).not.toHaveProperty('a');
    expect(restored.chat.branchTree.nodes.follow.parentId).toBe('generated');
    expect(restored.chat.xChat).toEqual({opaqueRef:3});expect(restored.chat.branchTree.nodes.hidden).toEqual(before.chat.branchTree.nodes.hidden);
    const finished=run({...restored,operation:'finalize',plan:result.plan,parts:[{type:'text',text:'output',unknown:{opaqueRef:5}}],newIDs:[]});
    const finalData=apply(restored,finished.changes);
    expect(resolveContent(finalData.contentStore,finalData.chat.branchTree.nodes.generated.contentHash)).toEqual([{type:'text',text:'output',unknown:{opaqueRef:5}}]);
    expect(finalData.chat.branchTree.activePath).toEqual(['s','u','generated','follow']);
    expect(original).toEqual(before);
  });
  it('keeps protection and explicit pinned replacement rules',()=>{
    const {chat,contentStore}=fixture();chat.protectedNodes={a:true};
    expect(run({chat,contentStore,operation:'prepare',action:'regenerate',nodeID:'u',newIDs:[]})).toMatchObject({status:'protected',changes:[],blockedNodeIds:['a']});
    expect(prepareContinueState([chat],{chatId:'chat',nodeId:'u'},contentStore)).toMatchObject({status:'protected'});
    chat.protectedNodes={};chat.branchTree.nodes.a.pinned=true;
    expect(run({chat,contentStore,operation:'prepare',action:'regenerate',nodeID:'a',newIDs:['generated']})).toMatchObject({status:'updated'});
  });
  it('uses actual flat conversion and finalizes the same target with immutable body references',()=>{
    const {chat,contentStore}=fixture();delete chat.branchTree;
    const before=structuredClone({chat,contentStore});
    const prepared=withEditingRuntime(['flat-s','flat-u','flat-a','flat-follow','generated'],[],100,()=>{
      const result=prepareRegenerateState([chat],{chatId:'chat',nodeId:'2'},contentStore);
      if(result.status!=='updated')throw Error(result.status);
      return insertAssistantPlaceholder(result.chats,0,result.submitMode,result.contentStore,result.insertIndex);
    });
    const target=prepared.targetNodeId;
    const finalized=finalizeGenerationState(prepared.updatedChats,0,target,[{type:'text',text:'result',unknown:{opaqueRef:4}}] as any,prepared.contentStore);
    expect(finalized.status).toBe('updated');if(finalized.status!=='updated')return;
    expect(finalized.chats[0].branchTree!.activePath).toEqual(['flat-s','flat-u','generated','flat-follow']);
    expect(finalized.chats[0].messages[2].content).toEqual([{type:'text',text:'result',unknown:{opaqueRef:4}}]);
    expect(prepared.updatedChats[0].messages[2].content).toEqual([{type:'text',text:''}]);expect({chat,contentStore}).toEqual(before);
  });
  it('invalidates only edited chat history after successful preparation',()=>{
    const {chat,contentStore}=fixture();
    const result=JSON.parse(branchHistory(JSON.stringify({operation:'edit',kind:'generationPlan',history:{past:[],future:[]},input:{chat,contentStore,operation:'prepare',action:'continue',nodeID:'u',viewingPath:chat.branchTree.activePath,newIDs:['generated'],now:100}})));
    expect(result.status).toBe('updated');expect(result.history).toEqual({past:[],future:[]});
    expect(result.plan.requestPath).toEqual(['s','u']);
  });
  it('retries a partial midchat assistant through the shared plan while preserving following and hidden nodes',()=>{
    const original=fixture(),before=structuredClone(original);
    const plan={targetNodeId:'a',messageIndex:2,activePath:['s','u','a','follow'],requestPath:['s','u'],prefillKey:'u',submitMode:'midchat',insertIndex:2};
    const result=run({...original,operation:'prepare',action:'retry',plan,newIDs:['retry']});
    expect(result.status).toBe('updated');
    expect(result.plan).toMatchObject({targetNodeId:'retry',messageIndex:2,requestPath:['s','u'],submitMode:'midchat',insertIndex:2});
    const restored=apply(original,result.changes);
    expect(restored.chat.branchTree.activePath).toEqual(['s','u','retry','follow']);
    expect(restored.chat.branchTree.nodes.follow.parentId).toBe('retry');
    expect(restored.chat.branchTree.nodes.hidden).toEqual(before.chat.branchTree.nodes.hidden);
    expect(restored.chat.branchTree.nodes).not.toHaveProperty('a');
    expect(restored.chat.xChat).toEqual(before.chat.xChat);
    expect(original).toEqual(before);
    expect(run({...original,operation:'prepare',action:'retry',plan:{...plan,targetNodeId:'other'},newIDs:['retry']})).toMatchObject({status:'stale',changes:[]});
    expect(run({...original,operation:'prepare',action:'retry',plan:{...plan,requestPath:['s','other']},newIDs:['retry']})).toMatchObject({status:'stale',changes:[]});
  });
  it('retries an empty append placeholder without adding another user message',()=>{
    const original=fixture();original.contentStore.a.content=[{type:'text',text:''}];original.chat.branchTree!.activePath=['s','u','a'];
    original.chat.messages=materializeActivePath(original.chat.branchTree!,original.contentStore,true);
    const plan={targetNodeId:'a',messageIndex:2,activePath:['s','u','a'],requestPath:['s','u'],prefillKey:'__sticky__',submitMode:'append',insertIndex:null};
    expect(retryTarget(original.chat,'append',null).removeIndex).toBe(2);
    const result=run({...original,operation:'prepare',action:'retry',plan,newIDs:['retry']});
    const restored=apply(original,result.changes);
    expect(result.plan).toMatchObject({targetNodeId:'retry',submitMode:'append',insertIndex:null,requestPath:['s','u']});
    expect(restored.chat.branchTree.activePath).toEqual(['s','u','retry']);
    expect(restored.chat.messages.map((message:any)=>message.role)).toEqual(['system','user','assistant']);
    expect(restored.chat.branchTree.nodes.follow).toMatchObject({contentHash:'follow',parentId:'u'});
  });
});
