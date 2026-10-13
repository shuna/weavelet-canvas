import { describe, expect, it, vi } from 'vitest';
import { localGenerationOutput } from '../../shared/google-sync/localGeneration';
import { chatConfig, normalizeRemoteConfig } from '../../shared/google-sync/chatConfig';
import { localModelContextLength, localModelDefaultMaxTokens } from './localModelLimits';
import { localGenerationOptions, localFallbackPrompt } from './localGenerationOutput';
import { getModelDefaultMaxTokens } from './modelLookup';
import { localModelRuntime } from '../local-llm/runtime';
import useStore from '@store/store';
import { _defaultChatConfig } from '../constants/chatDefaults';
describe('shared actual local completion boundary',()=>{
  it('keeps stop array priority and prefixes cumulative generated output only once',()=>{
    const result=JSON.parse(localGenerationOutput(JSON.stringify({fullText:'a SECOND b FIRST c',prefix:'prefix:',stop:['FIRST','SECOND']})));
    expect(result).toEqual({parts:[{type:'text',text:'prefix:a SECOND b '}],text:'prefix:a SECOND b ',reasoning:'',isEmpty:false,stopped:true});
    expect(JSON.parse(localGenerationOutput(JSON.stringify({fullText:'<think>raw</think>answer',prefix:'prefix:'})))).toMatchObject({text:'prefix:<think>raw</think>answer',reasoning:''});
    expect(JSON.parse(localGenerationOutput(JSON.stringify({fullText:''})))).toEqual({parts:[],text:'',reasoning:'',isEmpty:true,stopped:false});
  });
  it('uses exact worker fallback and runtime option defaults, including explicit zeros',()=>{
    expect(localFallbackPrompt([{role:'user',content:'hello'}],'prefix')).toBe('user: hello\n\nassistant:prefix');
    expect(localGenerationOptions({})).toEqual({maxTokens:256,temperature:0.7,stop:undefined});
    expect(localGenerationOptions({maxTokens:0,temperature:0,stop:['stop']})).toEqual({maxTokens:0,temperature:0,stop:['stop']});
  });
  it('matches existing local context/token priority without pulling runtime into native bridge',()=>{
    const state={localModels:[{id:'smollm2-360m-instruct-q8',displayMeta:{contextLength:10000}}]};
    expect(localModelContextLength(state as never,'smollm2-360m-instruct-q8',{contextLength:20000})).toBe(20000);
    expect(localModelDefaultMaxTokens(state as never,'smollm2-360m-instruct-q8')).toBe(9000);
    expect(localModelDefaultMaxTokens({},'smollm2-360m-instruct-q8')).toBe(7373);
    expect(localModelDefaultMaxTokens({},'unknown')).toBe(1844);
    const store=vi.spyOn(useStore,'getState').mockReturnValue(state as never);
    const caps=vi.spyOn(localModelRuntime,'getCapabilities').mockReturnValue({contextLength:20000} as never);
    expect(getModelDefaultMaxTokens('smollm2-360m-instruct-q8',undefined,'local')).toBe(18000);
    const config={..._defaultChatConfig,model:'old'};
    const result=JSON.parse(chatConfig(JSON.stringify({operation:'switch',config,modelState:state,
      localCapabilities:{'smollm2-360m-instruct-q8':{contextLength:20000}},target:{model:'smollm2-360m-instruct-q8',modelSource:'local'}})));
    expect(result.changes).toContainEqual({op:'set',path:['max_tokens'],value:18000});
    expect(result.changes).toContainEqual({op:'set',path:['modelSource'],value:'local'});
    expect(()=>normalizeRemoteConfig({...config,modelSource:'local'},{})).toThrow('Local');
    caps.mockRestore();store.mockRestore();
  });
});
