import { describe, expect, it } from 'vitest';
import { formatDebugLogLine, reduceDebugState, sortedDebugEntries } from './debugState';
import { debugState } from '../../shared/google-sync/debugState';

describe('debug state', () => {
  it('merges entries, puts active activity first, and formats logs', () => {
    let state = reduceDebugState({entries:{},logs:[]}, {type:'update',id:'done',patch:{label:'Done',status:'done'},updatedAt:4});
    state = reduceDebugState(state, {type:'update',id:'active',patch:{label:'Active',status:'active'},updatedAt:1});
    state = reduceDebugState(state, {type:'update',id:'active',patch:{detail:'receiving'},updatedAt:3});
    expect(state.entries.active).toEqual({id:'active',label:'Active',status:'active',detail:'receiving',updatedAt:3});
    const timestamp = new Date(2000, 0, 1, 12, 34, 56, 7).getTime();
    state = reduceDebugState(state, {type:'appendLog',line:{id:'line',timestamp,source:'sync',level:'warn',message:'retry'}});
    expect(sortedDebugEntries(state.entries).map((entry) => entry.id)).toEqual(['active','done']);
    expect(formatDebugLogLine(state.logs[0])).toBe('12:34:56.007 [sync] warn retry');
  });

  it('keeps the newest 500 logs and clears only completed entries', () => {
    const logs = Array.from({length:501}, (_, index) => ({id:String(index),timestamp:index,source:'s',level:'debug',message:String(index)}));
    const state = reduceDebugState({entries:{done:{id:'done',label:'Done',status:'done',updatedAt:1},error:{id:'error',label:'Error',status:'error',updatedAt:2}},logs}, {type:'clear'});
    expect(state).toEqual({entries:{error:{id:'error',label:'Error',status:'error',updatedAt:2}},logs:[]});
    const retained = reduceDebugState({entries:{},logs:[]}, {type:'appendLog',line:logs[0]});
    const bounded = reduceDebugState({...retained,logs}, {type:'appendLog',line:{id:'last',timestamp:999,source:'s',level:'info',message:'last'}}).logs;
    expect(bounded).toHaveLength(500);
    expect(bounded.map(line => line.id)).toEqual([...logs.slice(2).map(line => line.id),'last']);
  });

  it('shares reduction, removal, and display formatting with native', () => {
    const timestamp = new Date(2000, 0, 1, 12, 34, 56, 7).getTime();
    const state = {entries:{done:{id:'done',label:'Done',status:'done' as const,updatedAt:2}},logs:[{id:'line',timestamp,source:'native',level:'info',message:'ready'}]};
    expect(JSON.parse(debugState(JSON.stringify({operation:'reduce',state,action:{type:'remove',id:'done'}})))).toEqual({entries:{},logs:state.logs});
    expect(JSON.parse(debugState(JSON.stringify({operation:'display',state})))).toEqual({doneTTLms:30_000,entries:[state.entries.done],logs:[{...state.logs[0],formatted:'12:34:56.007 [native] info ready'}]});
  });
});
