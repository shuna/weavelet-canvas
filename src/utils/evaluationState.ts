import type { EvaluationContextInfo, SafetyCheckResult, QualityEvaluationResult, EvaluationResult, EvaluationResultMap, EvaluationSettings, EvaluationTriggerMode, SafetyThresholds, QualityThresholds, SafetyCategoryThreshold, QualityAxisThreshold, QualityScores, ModerationCategories, SafetyEngineMode } from '@type/evaluation';

export const defaultEvaluationSettings: EvaluationSettings = {
  safetyPreSend: 'manual', safetyPostReceive: 'manual',
  qualityPreSend: 'manual', qualityPostReceive: 'manual',
  safetyEngine: 'remote', hybridRemoteOnSafe: true,
};

export type EvaluationState = {
  evaluationSettings: EvaluationSettings;
  evaluationResults: EvaluationResultMap;
  safetyThresholds: SafetyThresholds;
  qualityThresholds: QualityThresholds;
};
export type EvaluationAction =
  | {type: 'set-result'; key: string; phase: 'pre-send'|'post-receive'; dimension: 'safety'|'quality'; result: SafetyCheckResult | QualityEvaluationResult; context: EvaluationContextInfo}
  | {type: 'setResult'; key: string; result: EvaluationResult}
  | {type: 'removeResult'; key: string}
  | {type: 'setSetting'; key: keyof EvaluationSettings; value: EvaluationTriggerMode}
  | {type: 'setSafetyEngine'; value: SafetyEngineMode}
  | {type: 'setHybridRemoteOnSafe'; value: boolean}
  | {type: 'setSafetyThreshold'; key: keyof ModerationCategories; value: SafetyCategoryThreshold}
  | {type: 'setQualityThreshold'; key: keyof QualityScores; value: QualityAxisThreshold};

export function mutateEvaluationState<T extends EvaluationState>(state: T, action: EvaluationAction): T {
  switch (action.type) {
    case 'set-result': {
      const existing = state.evaluationResults[action.key] ?? {phase: action.phase};
      const entry = action.dimension === 'safety'
        ? {...existing, phase: action.phase, safety: action.result as SafetyCheckResult, safetyContext: action.context}
        : {...existing, phase: action.phase, quality: action.result as QualityEvaluationResult, qualityContext: action.context};
      return {...state, evaluationResults: {...state.evaluationResults, [action.key]: entry}};
    }
    case 'setResult': return { ...state, evaluationResults: { ...state.evaluationResults, [action.key]: action.result } };
    case 'removeResult': {
      if (!(action.key in state.evaluationResults)) return state;
      const evaluationResults = { ...state.evaluationResults };
      delete evaluationResults[action.key];
      return { ...state, evaluationResults };
    }
    case 'setSetting': return state.evaluationSettings[action.key] === action.value ? state : { ...state, evaluationSettings: { ...state.evaluationSettings, [action.key]: action.value } };
    case 'setSafetyEngine': return { ...state, evaluationSettings: { ...state.evaluationSettings, safetyEngine: action.value } };
    case 'setHybridRemoteOnSafe': return { ...state, evaluationSettings: { ...state.evaluationSettings, hybridRemoteOnSafe: action.value } };
    case 'setSafetyThreshold': return { ...state, safetyThresholds: { ...state.safetyThresholds, [action.key]: action.value } };
    case 'setQualityThreshold': return { ...state, qualityThresholds: { ...state.qualityThresholds, [action.key]: action.value } };
  }
}
