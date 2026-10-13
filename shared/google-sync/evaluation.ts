import { hardOpenRouterConstraints } from '../../src/utils/openrouterRequest';
import { buildJudgeRequest, buildSafetyRequest, parseJudgeResponse, parseSafetyResponse } from '../../src/utils/evaluationCore';
import { resolveEvalContextCore } from '../../src/utils/evaluationContextCore';
import { defaultEvaluationSettings, mutateEvaluationState, type EvaluationAction, type EvaluationState } from '../../src/utils/evaluationState';
import { defaultQualityThresholds, defaultSafetyThresholds, evaluationResultKey, getSafetyStatus, moderationCategoryKeys, qualityAxisKeys, summarizeSafetyScores, systemQualityAxisKeys } from '../../src/types/evaluation';
import type { EvaluationResult, EvaluationScope, EvaluationOmittedMode, QualityEvaluationMode } from '../../src/types/evaluation';
import type { ChatInterface, OpenRouterChatSettings } from '../../src/types/chat';
import { diffJSONChanges } from '../../src/utils/jsonChanges';

type Input =
  | {operation: 'context'; chat: ChatInterface; omittedNodes?: Record<string, boolean>; messageIndex: number; role: string; scope: EvaluationScope; omittedMode: EvaluationOmittedMode}
  | {operation: 'judgeRequest'; userPrompt: string; assistantResponse?: string; endpoint: string; model: string; hasApiKey?: boolean; language?: string; mode?: QualityEvaluationMode; openRouter?: OpenRouterChatSettings; viaProxy?: boolean; endpointURL?: {protocol: string; hostname: string}}
  | {operation: 'safetyAllowed'; openRouter?: OpenRouterChatSettings}
  | {operation: 'safetyRequest'; endpoint: string; text: string; openRouter?: OpenRouterChatSettings}
  | {operation: 'parseQuality'; text: string; mode?: QualityEvaluationMode; now: number}
  | {operation: 'parseSafety'; data: Parameters<typeof parseSafetyResponse>[0]; now: number}
  | {operation: 'resultKey'; chatId?: string; nodeId?: string; chatID?: string; nodeID?: string; phase: 'pre-send'|'post-receive'}
  | {operation: 'defaults'}
  | {operation: 'display'; result: EvaluationResult; safetyThresholds?: typeof defaultSafetyThresholds; qualityThresholds?: typeof defaultQualityThresholds}
  | {operation: 'mutate'; state: EvaluationState; action: EvaluationAction};

export function evaluation(json: string): string {
  const input = JSON.parse(json) as Input;
  switch (input.operation) {
    case 'context': return JSON.stringify(resolveEvalContextCore(input.chat, input.omittedNodes ?? input.chat.omittedNodes ?? {}, input.messageIndex, input.role, input.scope, input.omittedMode));
    case 'judgeRequest': {
      const {chatUrl, headers, body} = buildJudgeRequest(input);
      return JSON.stringify({chatUrl, headers, body, authentication: input.hasApiKey ? 'bearer' : null});
    }
    case 'safetyAllowed': {
      if (hardOpenRouterConstraints(input.openRouter)) throw new Error('[EVAL_SAFETY_OPENROUTER_CONSTRAINTS]');
      return JSON.stringify(true);
    }
    case 'safetyRequest': return JSON.stringify(buildSafetyRequest(input));
    case 'parseQuality': return JSON.stringify({...parseJudgeResponse(input.text, input.mode), timestamp: input.now});
    case 'parseSafety': return JSON.stringify(parseSafetyResponse(input.data, input.now));
    case 'resultKey': return JSON.stringify(evaluationResultKey(input.chatId ?? input.chatID ?? '', input.nodeId ?? input.nodeID ?? '', input.phase));
    case 'defaults': return JSON.stringify({evaluationSettings: defaultEvaluationSettings, safetyThresholds: defaultSafetyThresholds, qualityThresholds: defaultQualityThresholds});
    case 'display': {
      const safetyThresholds = input.safetyThresholds ?? defaultSafetyThresholds;
      const qualityThresholds = input.qualityThresholds ?? defaultQualityThresholds;
      const safety = input.result.safety;
      const quality = input.result.quality;
      const keys = quality?.kind === 'system' ? systemQualityAxisKeys : qualityAxisKeys;
      const qThresholds = qualityThresholds as Record<string, {red:number;green:number}>;
      return JSON.stringify({
        phase: input.result.phase,
        safety: safety && {flagged: safety.flagged, ...summarizeSafetyScores(safety.categoryScores, safetyThresholds), categories: moderationCategoryKeys.map(key => ({key, flagged: safety.categories[key] ?? false, score: safety.categoryScores[key], status: safety.categoryScores[key] === undefined ? null : getSafetyStatus(safety.categoryScores[key]!, safetyThresholds[key])}))},
        quality: quality && {kind: quality.kind, axes: keys.map(key => {const score = quality.scores[key as keyof typeof quality.scores] as number;const threshold = qThresholds[key] ?? {red:0.5,green:0.8};return {key, score, status: score >= threshold.green ? 'green' : score >= threshold.red ? 'yellow' : 'red', reasoning: quality.reasoning[key as keyof typeof quality.reasoning] ?? ''};}), promptSuggestions: quality.promptSuggestions, configSuggestions: quality.configSuggestions},
        localSafety: input.result.localSafety,
      });
    }
    case 'mutate': return JSON.stringify({changes: diffJSONChanges(input.state, mutateEvaluationState(input.state, input.action))});
    default: throw new Error('Invalid evaluation operation.');
  }
}
