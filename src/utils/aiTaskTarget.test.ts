import { describe, expect, it } from 'vitest';
import { aiTaskFingerprint, orphanGenerationSessions } from './aiTaskTarget';
import { aiTaskTarget } from '../../shared/google-sync/aiTask';
import type { StoreState } from '@store/store';
const state = () => ({chats:[{id:'a',title:'A',config:{model:'model',xFuture:{opaqueRef:0}},omittedNodes:{},branchTree:{nodes:{
  user:{id:'user',role:'user',contentHash:'input'},out:{id:'out',role:'assistant',contentHash:'output'},
}}},{id:'b',title:'B',config:{model:'other'},branchTree:{nodes:{}}}]} as unknown as Pick<StoreState,'chats'>);
const ticket={kind:'generation' as const,chatId:'a',nodeId:'out',dependencyIds:['user']};
describe('shared actual Web task target',()=>{
  it('allows other chat reorder/changes and output streaming, but rejects changed request inputs',()=>{
    const before=state(), current=state();
    const first=aiTaskFingerprint(ticket,before);
    current.chats!.reverse(); current.chats![0].title='Edited B';
    current.chats![1].branchTree!.nodes.out.contentHash='streaming';
    expect(aiTaskFingerprint(ticket,current)).toBe(first);
    expect(JSON.parse(aiTaskTarget(JSON.stringify({ticket,before,current})))).toBe(true);
    current.chats![1].branchTree!.nodes.user.contentHash='changed';
    expect(JSON.parse(aiTaskTarget(JSON.stringify({ticket,before,current})))).toBe(false);
  });
  it('rejects deletion, omitted inputs and changed model/config without mutating either state',()=>{
    for(const change of ['delete','omitted','config']){
      const before=state(),current=state();
      if(change==='delete') delete current.chats![0].branchTree!.nodes.out;
      if(change==='omitted') current.chats![0].omittedNodes!.user=true;
      if(change==='config') current.chats![0].config.model='changed';
      const original=JSON.stringify({before,current});
      expect(JSON.parse(aiTaskTarget(JSON.stringify({ticket,before,current})))).toBe(false);
      expect(JSON.stringify({before,current})).toBe(original);
    }
  });
  it('selects only inactive same-chat generation targets in stable newest-first order',()=>{
    const nfd = 'e\u0301', nfc = 'é';
    const sessions = [{chatId:'a',targetNodeId:'active',startedAt:9},{chatId:'a',targetNodeId:'older',startedAt:2},{chatId:'b',targetNodeId:'other',startedAt:20},{chatId:'a',targetNodeId:nfd,startedAt:7},{chatId:'a',targetNodeId:nfc,startedAt:7}];
    const original = JSON.stringify(sessions);
    expect(orphanGenerationSessions('a',['active'],sessions).map(session=>session.targetNodeId)).toEqual([nfd,nfc,'older']);
    expect(JSON.stringify(sessions)).toBe(original);
  });
  it('treats an absent tree as an empty path and exposes the bridge focus target',()=>{
    const input = {operation:'orphans',chatId:'a',activePath:[],sessions:[{chatId:'a',targetNodeId:'one',startedAt:1},{chatId:'a',targetNodeId:'two',startedAt:2}]};
    expect(orphanGenerationSessions(undefined,[],input.sessions)).toEqual([]);
    expect(JSON.parse(aiTaskTarget(JSON.stringify(input)))).toEqual({count:2,targetNodeId:'two'});
  });
});
