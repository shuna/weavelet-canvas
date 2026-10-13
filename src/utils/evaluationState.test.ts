import {describe, expect, it} from 'vitest';
import {applyAutoEvaluationResult} from './evaluationState';
import {evaluation} from '../../shared/google-sync/evaluation';
import type {EvaluationResult} from '../types/evaluation';

describe('automatic evaluation result updates', () => {
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
});
