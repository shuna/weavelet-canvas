import { describe, expect, it } from 'vitest';
import { remoteOutput } from '../../shared/google-sync/remoteOutput';
import { extractReasoningFromEvent } from './remoteResponse';
const consume = (value: unknown, state?: unknown, streaming=true) => JSON.parse(remoteOutput(JSON.stringify({operation:'consume',value,state,streaming})));
const event = (delta:unknown, finish_reason?:string) => ({choices:[{delta,finish_reason}]});
describe('shared actual remote response conversion', () => {
  it('restores parser state across split think tags and flushes partial text at termination', () => {
    let result=consume(event({content:'before<th'}));
    expect(result.state.text).toBe('before');expect(result.state.think.pending).toBe('<th');
    result=consume(event({content:'ink>reason</thi'}),result.state);
    result=consume(event({content:'nk>after<',reasoning_details:[{type:'reasoning.summary',summary:'detail'}]},'length'),result.state);
    expect(result.finished).toBe(true);expect(result.state.finishReason).toBe('length');
    result=JSON.parse(remoteOutput(JSON.stringify({operation:'flush',state:result.state})));
    expect(result.parts).toEqual([{type:'reasoning',text:'reasondetail'},{type:'text',text:'beforeafter<'}]);
    expect(result.state.think.pending).toBe('');expect(result.isEmpty).toBe(false);
  });
  it('uses actual reasoning priority and structured text for nonstream', () => {
    const message={role:'assistant',reasoning:'preferred',reasoning_content:'ignored',reasoning_details:[{type:'reasoning.text',text:'ignored too'}],
      content:[{type:'thinking',thinking:'content reason'},{type:'text',text:'visible<think>inline</think>'},{type:'output_text',text:'tail'}]};
    expect(extractReasoningFromEvent(event(message) as never)).toBe('preferred');
    expect(consume({choices:[{message,finish_reason:'stop'}]},undefined,false).parts).toEqual([
      {type:'reasoning',text:'preferredinline'},{type:'text',text:'visibletail'}]);
    expect(consume(event({content:[{type:'thinking',thinking:'thought'},{type:'output_text',text:'text'}]})).parts).toEqual([
      {type:'reasoning',text:'thought'},{type:'text',text:'text'}]);
  });
  it('keeps usage-only stream events empty and explicit unsupported/error boundaries', () => {
    expect(consume({choices:[],usage:{}})).toMatchObject({parts:[],finished:false,isEmpty:true});
    expect(()=>consume({choices:[{message:{content:null,reasoning:'alone'}}]},undefined,false)).toThrow('content');
    expect(()=>consume(event({tool_calls:[]}))).toThrow('tool calls');
    expect(()=>consume({error:{message:'fake'}})).toThrow('Remote API');
  });
});
