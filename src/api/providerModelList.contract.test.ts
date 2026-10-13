import { describe, expect, it } from 'vitest';
import { providerModelList } from '../../shared/google-sync/providerModels';
import { normalizeModels } from './providerModels';
const list = (data: unknown) => JSON.parse(providerModelList(JSON.stringify({providerId:'openrouter',data}))).models;
describe('shared actual provider model normalization', () => {
  it('keeps accepted order and actual normalized metadata', () => {
    const data = {data:[{id:'gpt-4o',name:'first',context_length:128000,top_provider:{max_completion_tokens:16384},
      pricing:{prompt:'0.000002',completion:0.000008},architecture:{modality:'text+image->text'},
      supported_parameters:['reasoning',42],reasoning:{mandatory:true}},
      {id:'embedding-test',name:'excluded'}, {id:'gpt-4o',name:'second'}, {name:'fallback-name'}]};
    expect(list(data)).toEqual(JSON.parse(JSON.stringify(normalizeModels('openrouter',data))));
    expect(list(data).map((model:any)=>model.name)).toEqual(['first','second','fallback-name']);
    expect(list(data)[0]).toEqual({id:'gpt-4o',name:'first',providerId:'openrouter',supportedParameters:['reasoning'],
      contextLength:128000,maxCompletionTokens:16384,promptPrice:2,completionPrice:8,modelType:'image',streamSupport:true,
      supportsReasoning:true,reasoningMandatory:true,supportsVision:true,supportsAudio:false});
  });
  it('supports models response and existing malformed/unsupported filtering', () => {
    expect(list({models:[null,{id:'whisper-1'},{id:'valid',name:'kept'},{id:''}]}).map((model:any)=>model.id)).toEqual(['valid']);
    expect(list({})).toEqual([]);
  });
});
