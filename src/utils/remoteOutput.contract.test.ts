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
  it('rehydrates an unflushed checkpoint without finalizing an incomplete think tag', () => {
    let result = consume(event({content:'visible<th'}));
    result = JSON.parse(remoteOutput(JSON.stringify({operation:'restore',state:result.state})));
    expect(result.state.text).toBe('visible');
    expect(result.state.think.pending).toBe('<th');
    result = consume(event({content:'ink>reason</think> tail'}),result.state);
    expect(result.parts).toEqual([{type:'reasoning',text:'reason'},{type:'text',text:'visible tail'}]);
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
  it('accepts proxy metadata observations only after an eligible upstream origin', () => {
    for (const hostname of ['openrouter.ai', 'fixture.invalid']) {
      const headers = JSON.parse(remoteOutput(JSON.stringify({operation:'headers', endpointURL:{protocol:'https:',hostname},headers:{}})));
      const result = JSON.parse(remoteOutput(JSON.stringify({operation:'observation',state:headers.state,observation:{cost:0,responseCacheStatus:'HIT'}})));
      if (hostname === 'openrouter.ai') expect(result.state.observation).toEqual({cost:0,responseCacheStatus:'HIT'});
      else expect(result.state.observation).toBeUndefined();
    }
  });
  it('merges actual OpenRouter headers and usage-only events only for eligible origins', () => {
    const headers = { 'x-openrouter-cache-status': 'HIT', 'x-openrouter-cache-age': '4' };
    let result = JSON.parse(remoteOutput(JSON.stringify({ operation: 'headers', headers,
      endpointURL: { protocol: 'https:', hostname: 'openrouter.ai' } })));
    result = consume({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 7, cost: 0, prompt_tokens_details: { cached_tokens: 3 } } }, result.state);
    expect(result).toMatchObject({ parts: [], isEmpty: true, state: { observation: {
      responseCacheStatus: 'HIT', responseCacheAge: 4, promptTokens: 0, completionTokens: 7, cost: 0, cachedTokens: 3 } } });
    const unrelated = JSON.parse(remoteOutput(JSON.stringify({ operation: 'headers', headers,
      endpointURL: { protocol: 'https:', hostname: 'fixture.invalid' } })));
    expect(consume({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }, unrelated.state).state.observation).toBeUndefined();
  });
  it('keeps the first generation ID from headers or events independently of origin', () => {
    const header = JSON.parse(remoteOutput(JSON.stringify({ operation: 'headers',
      endpointURL: { protocol: 'https:', hostname: 'fixture.invalid' },
      headers: { 'x-generation-id': 'gen-header' } })));
    expect(header.state.generationId).toBe('gen-header');
    expect(header.state.observation).toBeUndefined();
    expect(consume({ id: 'gen-later', choices: [] }, header.state).state.generationId).toBe('gen-header');
    const ignored = consume({ id: 'other-id', choices: [] });
    expect(ignored.state.generationId).toBeUndefined();
    expect(consume({ id: 'gen-event', choices: [] }, ignored.state).state.generationId).toBe('gen-event');
  });
});
