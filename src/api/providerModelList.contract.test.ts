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

describe('shared actual provider cache backfill', () => {
  it('keeps favorite overrides/opaque attrs and unrelated provider cache while backfilling missing values', () => {
    const state = {favoriteModels:[{modelId:'a',providerId:'openrouter',supportsReasoning:false,contextLength:123,xUnknown:{opaqueRef:1}},
      {modelId:'other',providerId:'openai',xOther:{opaqueRef:2}}], providerModelCache:{openai:{opaqueRef:3}}};
    const model = {id:'a',name:'new',providerId:'openrouter',contextLength:999,maxCompletionTokens:456,supportsReasoning:true};
    const result = JSON.parse(providerModelList(JSON.stringify({operation:'cache',state,providerId:'openrouter',models:[model]})));
    expect(result.changes).toContainEqual({op:'set',path:['providerModelCache','openrouter'],value:[model]});
    expect(result.changes).toContainEqual({op:'set',path:['favoriteModels',0,'maxCompletionTokens'],value:456});
    expect(result.changes.filter((change:any)=>change.op!=='keys').map((change:any)=>change.path)).toEqual([
      ['favoriteModels',0,'maxCompletionTokens'],['providerModelCache','openrouter']]);
    expect(state.favoriteModels[0].contextLength).toBe(123);expect(state.favoriteModels[0].supportsReasoning).toBe(false);
  });
  it('publishes successful empty cache without changing favorites', () => {
    const state = {favoriteModels:[{modelId:'a',providerId:'openrouter',xUnknown:{opaqueRef:1}}],providerModelCache:{openrouter:[{id:'old'}]}};
    const result = JSON.parse(providerModelList(JSON.stringify({operation:'cache',state,providerId:'openrouter',models:[]})));
    expect(result.changes).toEqual([{op:'remove',path:['providerModelCache','openrouter',0]}]);
  });
});
