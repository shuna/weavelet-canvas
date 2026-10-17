import { describe, expect, it } from 'vitest';
import { openRouterStats } from '../../shared/google-sync/openrouterStats';
import { parseVerifiedStats, recoverOpenRouterStats, scheduleOpenRouterStats, transitionOpenRouterStats, type StatsState } from './openrouterStats';

const bridge = (input: unknown) => JSON.parse(openRouterStats(JSON.stringify(input)));
const empty = (): StatsState => ({ verifiedStats: {}, pendingVerifications: {} });
const verification = { generationId: 'gen-one', chatId: 'chat', targetNodeId: 'node' };
const payload = { data: { id:'gen-one', model:'model', tokens_prompt:2, tokens_completion:3,
  native_tokens_prompt:2, native_tokens_completion:3, total_cost:0.01, cache_discount:null } };

describe('OpenRouter verified stats shared state', () => {
  it('preserves other entries and unknown fields through queue/fetch/failure/retry/verify', () => {
    const previous = { ...verification, requestedAt:1, nextAttemptAt:2, attemptCount:2,
      status:'failed' as const, lastError:'old', extra:{ opaqueRef:1 } };
    let state: StatsState = { verifiedStats: {}, pendingVerifications: { other:{ ...previous, targetNodeId:'other' }, key:previous } };
    state = transitionOpenRouterStats(state,{type:'queue',key:'key',verification},100);
    expect(Object.keys(state.pendingVerifications)).toEqual(['other','key']);
    expect(state.pendingVerifications.key).toMatchObject({requestedAt:1,nextAttemptAt:10_100,attemptCount:2,extra:{opaqueRef:1}});
    expect(bridge({operation:'transition',state,action:{type:'fetching',key:'key'},now:200}).changes)
      .toContainEqual({op:'set',path:['pendingVerifications','key','attemptCount'],value:3});
    state = transitionOpenRouterStats(state,{type:'fetching',key:'key'},200);
    state = transitionOpenRouterStats(state,{type:'failed',key:'key',error:'failed',nextAttemptAt:Number.MAX_SAFE_INTEGER},300);
    expect(scheduleOpenRouterStats(state,400)).toEqual({dueKeys:['other'],nextAt:null});
    state = transitionOpenRouterStats(state,{type:'retry',key:'key'},400);
    expect(scheduleOpenRouterStats(state,400).dueKeys).toEqual(['other','key']);
    const stats = parseVerifiedStats(payload,'gen-one',500)!;
    state = transitionOpenRouterStats(state,{type:'verified',key:'key',stats},500);
    expect(state.pendingVerifications.key).toBeUndefined();
    expect((state.pendingVerifications.other as typeof previous).extra).toEqual({opaqueRef:1});
    expect(state.verifiedStats.key).toEqual(stats);
  });

  it('shares key/request/validated parsing and keeps fifty newest records', () => {
    expect(bridge({operation:'key',chatId:'chat',targetNodeId:'node'})).toEqual({key:'chat:::node'});
    expect(bridge({operation:'request',generationId:'gen-one'})).toEqual({
      endpoint:'https://openrouter.ai/api/v1/generation?id=gen-one',
      authentication:{header:'Authorization',scheme:'Bearer'},
    });
    expect(bridge({operation:'parse',payload,generationId:'gen-one',now:500}).stats).toMatchObject({generationId:'gen-one',totalCost:0.01,fetchedAt:500});
    for (const bad of [{...payload,data:{...payload.data,id:'other'}},
      {...payload,data:{...payload.data,total_cost:'0.01'}},
      {...payload,data:{...payload.data,cache_discount:Infinity}}]) {
      expect(parseVerifiedStats(bad,'gen-one',500)).toBeNull();
    }
    let state = empty();
    const stats = parseVerifiedStats(payload,'gen-one',500)!;
    for (let i=0;i<51;i++) state = transitionOpenRouterStats(state,{type:'verified',key:String(i),stats:{...stats,fetchedAt:i}},i);
    expect(Object.keys(state.verifiedStats)).toHaveLength(50);
    expect(state.verifiedStats['0']).toBeUndefined();
    expect(Object.keys(state.verifiedStats)[0]).toBe('1');
  });
  it('recovers interrupted fetching without changing unrelated entries', () => {
    const fetching = {...verification,requestedAt:1,nextAttemptAt:300,attemptCount:1,status:'fetching' as const,extra:'keep'};
    const state: StatsState = { verifiedStats:{}, pendingVerifications:{
      pending:{...verification,requestedAt:1,nextAttemptAt:200,attemptCount:0,status:'pending'},
      fetching,
    } };
    const recovered = recoverOpenRouterStats(state,100);
    expect(recovered.pendingVerifications.pending).toEqual(state.pendingVerifications.pending);
    expect(recovered.pendingVerifications.fetching).toMatchObject({status:'pending',nextAttemptAt:100,extra:'keep'});
    expect(bridge({operation:'recover',state,now:100}).changes).toContainEqual({
      op:'set',path:['pendingVerifications','fetching','status'],value:'pending',
    });
  });
  it('emits valid JSON patches when optional verification fields are absent', () => {
    let state = empty();
    const actions = [
      {type:'queue' as const,key:'key',verification},
      {type:'fetching' as const,key:'key'},
      {type:'failed' as const,key:'key',error:'failed',nextAttemptAt:900},
      {type:'retry' as const,key:'key'},
    ];
    for (const action of actions) {
      const { changes } = bridge({operation:'transition',state,action,now:100});
      expect(changes.filter((change: {op:string}) => change.op === 'set')
        .every((change: object) => Object.hasOwn(change,'value'))).toBe(true);
      state = JSON.parse(JSON.stringify(transitionOpenRouterStats(state,action,100)));
    }
    expect(state.pendingVerifications.key.status).toBe('pending');
  });
});
