import type { StoreSlice } from './store';
import type {
  EvaluationSettings,
  EvaluationTriggerMode,
  EvaluationResult,
  EvaluationResultMap,
  SafetyThresholds,
  QualityThresholds,
  QualityScores,
  QualityAxisThreshold,
  ModerationCategories,
  SafetyCategoryThreshold,
  SafetyEngineMode,
  AxisProgressMap,
} from '@type/evaluation';
import { defaultQualityThresholds, defaultSafetyThresholds } from '@type/evaluation';
import { defaultEvaluationSettings, mutateEvaluationState } from '@utils/evaluationState';

export interface EvaluationSlice {
  evaluationSettings: EvaluationSettings;
  safetyThresholds: SafetyThresholds;
  qualityThresholds: QualityThresholds;
  evaluationResults: EvaluationResultMap;
  /** Currently running evaluation keys (for loading indicators) */
  evaluationPending: Record<string, boolean>;
  /** Per-axis progress for local quality evaluation (keyed same as evaluationPending) */
  evaluationAxisProgress: Record<string, AxisProgressMap>;
  setEvaluationSetting: (
    key: keyof EvaluationSettings,
    mode: EvaluationTriggerMode
  ) => void;
  setQualityThreshold: (
    axis: keyof QualityScores,
    threshold: QualityAxisThreshold
  ) => void;
  setSafetyThreshold: (
    category: keyof ModerationCategories,
    threshold: SafetyCategoryThreshold
  ) => void;
  setEvaluationResult: (key: string, result: EvaluationResult) => void;
  clearEvaluationResult: (key: string) => void;
  setEvaluationPending: (key: string, pending: boolean) => void;
  setSafetyEngine: (mode: SafetyEngineMode) => void;
  setHybridRemoteOnSafe: (enabled: boolean) => void;
  setEvaluationAxisProgress: (key: string, progress: AxisProgressMap) => void;
  clearEvaluationAxisProgress: (key: string) => void;
}

export const createEvaluationSlice: StoreSlice<EvaluationSlice> = (set, get) => ({
  evaluationSettings: defaultEvaluationSettings,
  safetyThresholds: defaultSafetyThresholds,
  qualityThresholds: defaultQualityThresholds,
  evaluationResults: {},
  evaluationPending: {},
  evaluationAxisProgress: {},

  setSafetyThreshold: (category, threshold) => {
    set((prev: EvaluationSlice) => ({
      safetyThresholds: mutateEvaluationState(prev, {type: 'setSafetyThreshold', key: category, value: threshold}).safetyThresholds,
    }));
  },

  setQualityThreshold: (axis, threshold) => {
    set((prev: EvaluationSlice) => ({
      qualityThresholds: mutateEvaluationState(prev, {type: 'setQualityThreshold', key: axis, value: threshold}).qualityThresholds,
    }));
  },

  setEvaluationSetting: (key, mode) => {
    const current = get().evaluationSettings[key];
    if (current === mode) return;
    set((prev: EvaluationSlice) => ({
      evaluationSettings: mutateEvaluationState(prev, {type: 'setSetting', key, value: mode}).evaluationSettings,
    }));
  },

  setEvaluationResult: (key, result) => {
    set((prev: EvaluationSlice) => ({
      evaluationResults: mutateEvaluationState(prev, {type: 'setResult', key, result}).evaluationResults,
    }));
  },

  clearEvaluationResult: (key) => {
    if (!(key in get().evaluationResults)) return;
    set((prev: EvaluationSlice) => ({
      evaluationResults: mutateEvaluationState(prev, {type: 'removeResult', key}).evaluationResults,
    }));
  },

  setEvaluationPending: (key, pending) => {
    set((prev: EvaluationSlice) => ({
      evaluationPending: { ...prev.evaluationPending, [key]: pending },
    }));
  },

  setSafetyEngine: (mode) => {
    set((prev: EvaluationSlice) => ({
      evaluationSettings: mutateEvaluationState(prev, {type: 'setSafetyEngine', value: mode}).evaluationSettings,
    }));
  },

  setHybridRemoteOnSafe: (enabled) => {
    set((prev: EvaluationSlice) => ({
      evaluationSettings: mutateEvaluationState(prev, {type: 'setHybridRemoteOnSafe', value: enabled}).evaluationSettings,
    }));
  },

  setEvaluationAxisProgress: (key, progress) => {
    set((prev: EvaluationSlice) => ({
      evaluationAxisProgress: {
        ...prev.evaluationAxisProgress,
        [key]: { ...(prev.evaluationAxisProgress[key] ?? {}), ...progress },
      },
    }));
  },

  clearEvaluationAxisProgress: (key) => {
    set((prev: EvaluationSlice) => {
      const next = { ...prev.evaluationAxisProgress };
      delete next[key];
      return { evaluationAxisProgress: next };
    });
  },
});
