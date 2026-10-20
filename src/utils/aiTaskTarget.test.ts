import { describe, expect, it } from 'vitest';
import { aiTaskFingerprint } from './aiTaskTarget';
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
});
