import {describe, expect, it} from 'vitest';
import {autoEvaluationPlan, autoPreSendSafetyAllowed, type AutoEvaluationInput} from './evaluationAutoCore';
import {evaluation} from '../../shared/google-sync/evaluation';
import type {EvaluationSettings} from '../types/evaluation';

const settings: EvaluationSettings = {
  safetyPreSend:'auto', safetyPostReceive:'manual', qualityPreSend:'manual', qualityPostReceive:'auto',
  safetyEngine:'remote', hybridRemoteOnSafe:true,
};
const content: AutoEvaluationInput['userContent'] = [
  {type:'text',text:'first'}, {type:'reasoning',text:'private reasoning'},
  {type:'text',text:'second'}, {type:'tool_result',tool_call_id:'call',content:'tool output'},
];
const bridge = (input: AutoEvaluationInput) => JSON.parse(evaluation(JSON.stringify({operation:'autoPlan',...input})));

describe('automatic evaluation plan', () => {
  it('checks pre-send safety constraints independently of text availability', () => {
    const routing = {routing:{only:['fixture-provider'],require_parameters:true}};
    const imageOnly: AutoEvaluationInput = {phase:'pre-send', userContent:[{type:'image_url',image_url:{url:'data:image/png;base64,FAKE',detail:'auto'}}],settings};
    expect(autoEvaluationPlan(imageOnly).shouldSafety).toBe(false);
    expect(autoPreSendSafetyAllowed(settings,routing)).toBe(false);
    expect(JSON.parse(evaluation(JSON.stringify({operation:'autoPreSendAllowed',settings,openRouter:routing})))).toBe(false);
    expect(autoPreSendSafetyAllowed({...settings,safetyEngine:'local'},routing)).toBe(true);
    expect(autoPreSendSafetyAllowed({...settings,safetyPreSend:'manual'},routing)).toBe(true);
    expect(autoPreSendSafetyAllowed(settings)).toBe(true);
  });
  it('uses text parts and pre-send settings without adding manual context', () => {
    const input: AutoEvaluationInput = {phase:'pre-send',userContent:content,settings};
    const expected = {userText:'first\nsecond',safetyText:'first\nsecond',shouldSafety:true,shouldQuality:false};
    expect(autoEvaluationPlan(input)).toEqual({...expected,assistantText:undefined});
    expect(bridge(input)).toEqual(expected);
  });

  it('uses assistant text for post-receive safety but user text for quality', () => {
    const input: AutoEvaluationInput = {phase:'post-receive',userContent:content,
      assistantContent:[{type:'text',text:'answer'}, {type:'text',text:'more'}],
      settings:{...settings,safetyPostReceive:'auto'}};
    expect(bridge(input)).toEqual({userText:'first\nsecond',assistantText:'answer\nmore',safetyText:'answer\nmore',shouldSafety:true,shouldQuality:true});
  });

  it('disables both dimensions when the user has no text', () => {
    const input: AutoEvaluationInput = {phase:'post-receive',userContent:[{type:'reasoning',text:'hidden'}],
      assistantContent:[{type:'text',text:'answer'}],settings:{...settings,safetyPostReceive:'auto'}};
    expect(bridge(input)).toEqual({userText:'',assistantText:'answer',safetyText:'answer',shouldSafety:false,shouldQuality:false});
  });
});
