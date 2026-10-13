import { describe, expect, it, vi } from 'vitest';
import { chatConfig, normalizeRemoteConfig } from '../../shared/google-sync/chatConfig';
import { generationRequest } from '../../shared/google-sync/generation';
import { _defaultChatConfig } from '../constants/chatDefaults';
import useStore from '@store/store';
import { switchConfigModel } from './modelSettings';
import { normalizeConfigStream } from './streamSupport';
import type { ConfigInterface } from '../types/chat';
const state = { providerCustomModels: {}, favoriteModels: [], providerModelCache: {openrouter:[{
  id:'target',name:'fake',providerId:'openrouter' as const,contextLength:10000,maxCompletionTokens:3200,streamSupport:false,
}]} };
const apply = (config: any, changes: any[]) => {
  const result = structuredClone(config);
  for (const change of changes) {
    let owner = result;
    for (const key of change.path.slice(0,-1)) owner = owner[key];
    const key = change.path.at(-1);
    if (change.op === 'set') owner[key] = change.value;
    else if (change.op === 'remove') delete owner[key];
    else if (change.op === 'keys') {
      const object = change.path.length ? owner[key] : result;
      const values = {...object};
      for (const name of Object.keys(object)) delete object[name];
      for (const name of change.keys) object[name] = values[name];
    }
  }
  return result;
};
describe('shared remote chat config actual Web rules', () => {
  it('shares stream/token correction with actual Web and generation', () => {
    const config = {..._defaultChatConfig,model:'target',providerId:'openrouter' as const};
    const spy = vi.spyOn(useStore,'getState').mockReturnValue(state as never);
    expect(normalizeRemoteConfig(config,state)).toEqual(normalizeConfigStream(config));
    expect(normalizeRemoteConfig(config,state)).toMatchObject({max_tokens:3200,stream:false});
    expect(normalizeRemoteConfig({...config,max_tokens:123,stream:false},state)).toMatchObject({max_tokens:123,stream:false});
    spy.mockRestore();
    const body = JSON.parse(generationRequest(JSON.stringify({messages:[{role:'user',content:[{type:'text',text:'test'}]}],config,modelState:state})));
    expect(body).toMatchObject({max_tokens:3200,stream:false});
  });
  it('preserves opaque config and saved entry metadata through switch, with actual Web entry', () => {
    const oldKey = JSON.stringify(['remote','openrouter','source']);
    const config = {..._defaultChatConfig,model:'source',providerId:'openrouter' as const,temperature:0.3,
      xConfig:{opaqueRef:1},modelSettings:{[oldKey]:{..._defaultChatConfig,xSaved:{opaqueRef:2}}}} as unknown as ConfigInterface;
    const spy = vi.spyOn(useStore,'getState').mockReturnValue(state as never);
    const expected = normalizeConfigStream(switchConfigModel(config,{model:'target',providerId:'openrouter',modelSource:undefined}));
    const result = JSON.parse(chatConfig(JSON.stringify({operation:'switch',config,modelState:state,target:{model:'target',providerId:'openrouter'}})));
    const switched = apply(config,result.changes);
    expect(switched).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(switched.xConfig).toEqual({opaqueRef:1});
    expect(switched.modelSettings[oldKey].xSaved).toEqual({opaqueRef:2});
    const restored = apply(switched,JSON.parse(chatConfig(JSON.stringify({operation:'switch',config:switched,modelState:state,target:{model:'source',providerId:'openrouter'}}))).changes);
    expect(restored.temperature).toBe(0.3); expect(restored.xSaved).toEqual({opaqueRef:2});
    spy.mockRestore();
  });
  it('clears JSON-omitted target provider and source like the Web explicit undefined target', () => {
    const config = {..._defaultChatConfig,model:'source',providerId:'openrouter',modelSource:'remote'};
    const result = JSON.parse(chatConfig(JSON.stringify({operation:'switch',config,target:{model:'other'}})));
    expect(apply(config,result.changes)).not.toHaveProperty('providerId');
    expect(apply(config,result.changes)).not.toHaveProperty('modelSource');
    expect(apply(config,JSON.parse(chatConfig(JSON.stringify({operation:'switch',config,target:{model:'local',modelSource:'local'}}))).changes)).toMatchObject({model:'local',modelSource:'local',max_tokens:1844,stream:true});
  });
});
