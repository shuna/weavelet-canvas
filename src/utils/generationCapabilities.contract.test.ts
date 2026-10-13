import { describe, expect, it } from 'vitest';
import { generationRequest } from '../../shared/google-sync/generation';
import { _defaultChatConfig } from '../constants/chatDefaults';
import { getRequestReasoningCapabilities, modelSupportsReasoning } from './modelReasoning';
const config = {..._defaultChatConfig,model:'anthropic/claude-opus-5.5',providerId:'openrouter' as const,reasoning_effort:'none' as const};
describe('generation actual remote reasoning lookup', () => {
  it('keeps custom support override and favorite mandatory priority including false', () => {
    const state = {providerCustomModels:{openrouter:[{modelId:config.model,providerId:'openrouter' as const,modelType:'text' as const,supportsReasoning:false}]},
      favoriteModels:[{modelId:config.model,providerId:'openrouter' as const,reasoningMandatory:false}],
      providerModelCache:{openrouter:[{id:config.model,name:'fake',providerId:'openrouter' as const,reasoningMandatory:true}]}};
    expect(modelSupportsReasoning(state,config.model,'openrouter')).toBe(false);
    expect(getRequestReasoningCapabilities({...config,force_reasoning:true},state)).toEqual({supportsReasoning:false,requiresReasoning:false});
    expect(getRequestReasoningCapabilities(config,{})).toEqual({supportsReasoning:true,requiresReasoning:true});
  });
  it('uses modelState for requests and retains legacy capabilities contract', () => {
    const input = {messages:[{role:'user',content:[{type:'text',text:'test'}]}], config,
      capabilities:{supportsReasoning:false,requiresReasoning:false}};
    const legacy = JSON.parse(generationRequest(JSON.stringify(input)));
    expect(legacy).not.toHaveProperty('reasoning');
    const body = JSON.parse(generationRequest(JSON.stringify({...input,modelState:{favoriteModels:[{modelId:config.model,providerId:'openrouter',supportsReasoning:true,reasoningMandatory:true}]}})));
    expect(body.reasoning).toEqual({effort:'low'});
  });
});
