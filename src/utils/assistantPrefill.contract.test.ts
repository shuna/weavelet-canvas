import { describe, expect, it } from 'vitest';
import { assistantPrefill } from '../../shared/google-sync/assistantPrefill';
import { isAssistantPrefillEnabled, isAssistantPrefillLocation, shouldConsumeAssistantPrefill } from './assistantPrefill';
import { normalizeAssistantPrefill } from './localGenerationInput';
import { resolveAssistantPrefillKey } from './generationPlan';

const call = (input: unknown) => JSON.parse(assistantPrefill(JSON.stringify(input)));

describe('actual Web assistant prefill rules', () => {
  it('keeps sticky user placement and normal user/read-only/collapse/node gates', () => {
    expect(isAssistantPrefillEnabled('local')).toBe(true);
    expect(isAssistantPrefillEnabled('remote')).toBe(false);
    expect(isAssistantPrefillEnabled()).toBe(false);
    expect(isAssistantPrefillLocation({sticky:true,role:'user',readOnly:true,collapsed:true})).toBe(true);
    expect(isAssistantPrefillLocation({sticky:false,role:'user',nodeId:'0'})).toBe(true);
    for (const override of [{role:'assistant'},{readOnly:true},{collapsed:true},{nodeId:undefined}]) {
      expect(isAssistantPrefillLocation({sticky:false,role:'user',nodeId:'node',...override})).toBe(false);
    }
  });
  it('uses existing append/midchat key resolution without chat bodies or changing activePath', () => {
    const activePath=['system','user','assistant'];
    for (const [mode,insertIndex,key] of [['append',null,'__sticky__'],['midchat',2,'user'],['midchat',null,'system'],['midchat',0,'__sticky__'],['midchat',8,'__sticky__']] as const) {
      expect(call({operation:'resolve',mode,insertIndex,activePath})).toEqual({key});
      expect(resolveAssistantPrefillKey({branchTree:{activePath}},mode,insertIndex)).toBe(key);
    }
    expect(call({operation:'resolve',mode:'midchat',insertIndex:2})).toEqual({key:'__sticky__'});
    expect(activePath).toEqual(['system','user','assistant']);
  });
  it('consumes only the unchanged normalized local prefix while preserving raw draft and Unicode spelling', () => {
    const draft='\u00a0\u3000e\u0301\n\ufeff';
    const prefix=normalizeAssistantPrefill(draft);
    expect(prefix).toBe('e\u0301');
    expect(call({operation:'consume',modelSource:'local',draft,prefix})).toEqual({consumed:true});
    expect(shouldConsumeAssistantPrefill(true,draft,prefix)).toBe(true);
    for (const input of [
      {modelSource:'remote',draft,prefix}, {modelSource:'local',draft:'edited',prefix},
      {modelSource:'local',draft:'é',prefix}, {modelSource:'local',draft:' \n '},
      {modelSource:'local',draft:''}, {modelSource:'local'},
    ]) expect(call({operation:'consume',...input})).toEqual({consumed:false});
    expect(draft).toBe('\u00a0\u3000e\u0301\n\ufeff');
  });
});
