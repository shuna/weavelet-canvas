import {describe, expect, it} from 'vitest';
import {applyAutoEvaluationResult, dualThresholdPercentages, editDualThreshold, parseDualThresholdInput} from './evaluationState';
import {evaluation} from '../../shared/google-sync/evaluation';
import type {EvaluationResult} from '../types/evaluation';

describe('automatic evaluation result updates', () => {
  it('uses the slider rounding, peer clamp, and numeric input rules', () => {
    expect(dualThresholdPercentages({red:0.245,green:0.755})).toEqual({red:25,green:76});
    expect(editDualThreshold({red:0.245,green:0.755}, 'red', 99)).toEqual({red:0.76,green:0.755});
    expect(editDualThreshold({red:0.245,green:0.755}, 'green', 1)).toEqual({red:0.245,green:0.25});
    expect(parseDualThresholdInput('12.9')).toBe(12);
    expect(parseDualThresholdInput('-4')).toBe(0);
    expect(parseDualThresholdInput('none')).toBeNull();
  });

  it('keeps untouched dimensions and unknown fields while clearing only a replaced manual context', () => {
    const old = {
      phase:'pre-send', safety:{flagged:false}, quality:{kind:'old'}, localSafety:{screening:'safe'},
      safetyContext:{scope:'single'}, qualityContext:{scope:'full-context'}, future:{raw:'unchanged'},
    } as unknown as EvaluationResult;
    const quality = {kind:'new'} as unknown as EvaluationResult['quality'];
    const updated = applyAutoEvaluationResult(old, {phase:'post-receive',quality});
    expect(updated).toMatchObject({phase:'post-receive',safety:old.safety,localSafety:old.localSafety,
      safetyContext:old.safetyContext,future:{raw:'unchanged'},quality});
    expect(updated).not.toHaveProperty('qualityContext');
    expect(old).toHaveProperty('qualityContext');
    const localSafety = {screening:'warn'} as unknown as EvaluationResult['localSafety'];
    expect(applyAutoEvaluationResult(updated,{phase:'post-receive',localSafety})).toMatchObject({
      safety:old.safety,quality,localSafety,safetyContext:old.safetyContext,future:{raw:'unchanged'},
    });
    expect(applyAutoEvaluationResult(old,{phase:'pre-send',safety:old.safety})).not.toHaveProperty('safetyContext');
  });

  it('emits a native delta that preserves opaque old fields and the incoming raw dimension', () => {
    const state = {evaluationResults:{slot:{phase:'pre-send',safety:{opaqueRef:0},qualityContext:{opaqueRef:1},
      future:{opaqueRef:2},localSafety:{opaqueRef:3}}}};
    const action = {type:'setAutoResult',key:'slot',result:{phase:'post-receive',quality:{opaqueRef:4}}};
    const {changes} = JSON.parse(evaluation(JSON.stringify({operation:'mutate',state,action})));
    expect(changes).toContainEqual({op:'remove',path:['evaluationResults','slot','qualityContext']});
    expect(changes).toContainEqual({op:'set',path:['evaluationResults','slot','quality'],value:{opaqueRef:4}});
    expect(changes).toContainEqual({op:'set',path:['evaluationResults','slot','phase'],value:'post-receive'});
    expect(changes.some((change: {path: string[]}) => ['safety','localSafety','future'].includes(change.path.at(-1) ?? ''))).toBe(false);
  });

  it('shares threshold fields and edits with native while retaining the current pair metadata', () => {
    const fields = JSON.parse(evaluation(JSON.stringify({operation:'thresholdFields',kind:'safety',safetyThresholds:{hate:{review:0.245,block:0.755}}})));
    expect(fields.find((value: {key:string}) => value.key === 'hate')).toMatchObject({value:{review:0.245,block:0.755},defaults:{review:0.7,block:0.9},percentages:{review:25,block:76},defaultPercentages:{review:70,block:90}});
    const current = {review:0.245,block:0.755,future:{opaqueRef:0}};
    expect(JSON.parse(evaluation(JSON.stringify({operation:'thresholdEdit',kind:'safety',key:'hate',field:'review',percent:99,current})))).toEqual({...current,review:0.76});
    expect(JSON.parse(evaluation(JSON.stringify({operation:'thresholdEdit',kind:'safety',key:'hate',field:'review',reset:true,current})))).toEqual({...current,review:0.7});
    expect(JSON.parse(evaluation(JSON.stringify({operation:'thresholdEdit',kind:'quality',key:'coherence',field:'red',text:'101',current:{red:0.2,green:0.8}})))).toMatchObject({red:0.8,green:0.8});
    expect(JSON.parse(evaluation(JSON.stringify({operation:'thresholdEdit',kind:'quality',key:'coherence',field:'red',text:'12.9',current:{red:0.2,green:0.8}})))).toMatchObject({red:0.12});
    expect(JSON.parse(evaluation(JSON.stringify({operation:'thresholdEdit',kind:'quality',key:'coherence',field:'red',text:'1e2',current:{red:0.2,green:0.8}})))).toMatchObject({red:0.01});
    expect(JSON.parse(evaluation(JSON.stringify({operation:'thresholdEdit',kind:'quality',key:'coherence',field:'red',text:'',current:{red:0.2,green:0.8}})))).toBeNull();
    expect(() => evaluation(JSON.stringify({operation:'thresholdFields',kind:'other'}))).toThrow('Invalid threshold kind');
    expect(() => evaluation(JSON.stringify({operation:'thresholdEdit',kind:'quality',key:'hate',field:'red',percent:10,current:{red:0.2,green:0.8}}))).toThrow('Invalid threshold key');
    expect(() => evaluation(JSON.stringify({operation:'thresholdEdit',kind:'quality',key:'coherence',field:'red',percent:10.5,current:{red:0.2,green:0.8}}))).toThrow('Invalid threshold percent');
  });
});
