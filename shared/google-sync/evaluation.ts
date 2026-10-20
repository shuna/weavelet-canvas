import { localAxisPrompt, localAxisScore, localModeration, localModerationModelID, localQualityResult, localSafetyPolicy, parseLocalQualityResponse } from '../../src/utils/localEvaluationCore';
import { hardOpenRouterConstraints } from '../../src/utils/openrouterRequest';
import { buildJudgeRequest, buildSafetyRequest, parseJudgeResponse, parseSafetyResponse } from '../../src/utils/evaluationCore';
import { resolveEvalContextCore } from '../../src/utils/evaluationContextCore';
import { autoEvaluationPlan, autoPreSendSafetyAllowed, type AutoEvaluationInput } from '../../src/utils/evaluationAutoCore';
import { defaultEvaluationSettings, dualThresholdPercentages, editDualThreshold, mutateEvaluationState, parseDualThresholdInput, type EvaluationAction, type EvaluationState } from '../../src/utils/evaluationState';
import { defaultQualityThresholds, defaultSafetyThresholds, evaluationResultKey, getSafetyStatus, moderationCategoryKeys, qualityAxisKeys, summarizeSafetyScores, systemQualityAxisKeys } from '../../src/types/evaluation';
import type { EvaluationResult, EvaluationScope, EvaluationOmittedMode, QualityEvaluationMode, QualityScores, LocalModerationResult, SafetyEngineMode } from '../../src/types/evaluation';
import type { ChatInterface, OpenRouterChatSettings } from '../../src/types/chat';
import { diffJSONChanges } from '../../src/utils/jsonChanges';

type Input =
  | ({operation: 'autoPlan'} & AutoEvaluationInput)
  | {operation: 'autoPreSendAllowed'; settings: AutoEvaluationInput['settings']; openRouter?: OpenRouterChatSettings}
  | {operation: 'context'; chat: ChatInterface; omittedNodes?: Record<string, boolean>; messageIndex: number; role: string; scope: EvaluationScope; omittedMode: EvaluationOmittedMode}
  | {operation: 'judgeRequest'; userPrompt: string; assistantResponse?: string; endpoint: string; model: string; hasApiKey?: boolean; language?: string; mode?: QualityEvaluationMode; openRouter?: OpenRouterChatSettings; viaProxy?: boolean; endpointURL?: {protocol: string; hostname: string}}
  | {operation: 'safetyAllowed'; openRouter?: OpenRouterChatSettings}
  | {operation: 'safetyRequest'; endpoint: string; text: string; openRouter?: OpenRouterChatSettings}
  | {operation: 'parseQuality'; text: string; mode?: QualityEvaluationMode; now: number}
  | {operation: 'parseSafety'; data: Parameters<typeof parseSafetyResponse>[0]; now: number}
  | {operation: 'resultKey'; chatId?: string; nodeId?: string; chatID?: string; nodeID?: string; phase: 'pre-send'|'post-receive'}
  | {operation: 'localAxes'}
  | {operation: 'localPrompt'; axis: keyof QualityScores; text: string; assistantResponse?: string; language: string}
  | {operation: 'localAxisScore'; raw: string}
  | {operation: 'localQualityResult'; outputs: Partial<Record<keyof QualityScores, string>>; now: number}
  | {operation: 'localParse'; raw: string; now: number}
  | {operation: 'localModeration'; labels: {label: string; score: number}[]; now: number}
  | {operation: 'localModerationModel'; state: {localModelEnabled?: boolean; activeLocalModels?: {analysis?: string | null; moderation?: string | null}}}
  | {operation: 'localPolicy'; safetyEngine: SafetyEngineMode; hybridRemoteOnSafe: boolean; localSafety?: LocalModerationResult}
  | {operation: 'defaults'}
  | {operation: 'display'; result: EvaluationResult; safetyThresholds?: typeof defaultSafetyThresholds; qualityThresholds?: typeof defaultQualityThresholds}
  | {operation: 'thresholdFields'; kind: 'safety'|'quality'; safetyThresholds?: Partial<typeof defaultSafetyThresholds>; qualityThresholds?: Partial<typeof defaultQualityThresholds>}
  | {operation: 'thresholdEdit'; kind: 'safety'|'quality'; key: string; field: string; percent?: number; text?: string; reset?: boolean; current: Record<string, unknown>}
  | {operation: 'mutate'; state: EvaluationState; action: EvaluationAction};

const thresholdPair = (value: object, first: string, second: string) => {
  if (!value || typeof value !== 'object') throw new Error('Invalid threshold pair.');
  const fields = value as Record<string, unknown>, a = fields[first], b = fields[second];
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || a > 1 || b < 0 || b > 1)
    throw new Error('Invalid threshold pair.');
  return {red:a,green:b};
};

const thresholdFieldRows = (kind: 'safety'|'quality', safety: Partial<typeof defaultSafetyThresholds>, quality: Partial<typeof defaultQualityThresholds>) => {
  const row = (key: string, value: object, fallback: object, names: readonly [string,string]) => {
    const current = thresholdPair(value, names[0], names[1]), initial = thresholdPair(fallback, names[0], names[1]);
    const percentages = dualThresholdPercentages(current), defaultPercentages = dualThresholdPercentages(initial);
    return {key,value,defaults:fallback,
      percentages: kind === 'safety' ? {review:percentages.red,block:percentages.green} : percentages,
      defaultPercentages: kind === 'safety' ? {review:defaultPercentages.red,block:defaultPercentages.green} : defaultPercentages};
  };
  if (kind === 'safety') return moderationCategoryKeys.map(key => row(key, safety[key] ?? defaultSafetyThresholds[key], defaultSafetyThresholds[key], ['review','block']));
  return qualityAxisKeys.map(key => row(key, quality[key] ?? defaultQualityThresholds[key], defaultQualityThresholds[key], ['red','green']));
};

// Wllama's TextEncoder replaces lone UTF-16 surrogates before inference.
const wllamaPromptText = (value: string): string => Array.from(value, scalar =>
  scalar.length === 1 && scalar.charCodeAt(0) >= 0xd800 && scalar.charCodeAt(0) <= 0xdfff ? '\ufffd' : scalar).join('');

export function evaluation(json: string): string {
  const input = JSON.parse(json) as Input;
  switch (input.operation) {
    case 'autoPreSendAllowed': return JSON.stringify(autoPreSendSafetyAllowed(input.settings, input.openRouter));
    case 'autoPlan': return JSON.stringify(autoEvaluationPlan(input));
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
    case 'localAxes': return JSON.stringify(qualityAxisKeys);
    case 'localPrompt': {
      const plan = localAxisPrompt(input.axis, input.text, input.assistantResponse, input.language);
      return JSON.stringify({...plan, prompt: wllamaPromptText(plan.prompt), fallback: wllamaPromptText(plan.fallback)});
    }
    case 'localAxisScore': return JSON.stringify(localAxisScore(input.raw));
    case 'localQualityResult': return JSON.stringify(localQualityResult(input.outputs, input.now));
    case 'localParse': return JSON.stringify(parseLocalQualityResponse(input.raw, input.now));
    case 'localModeration': return JSON.stringify(localModeration(input.labels, input.now));
    case 'localModerationModel': return JSON.stringify(localModerationModelID(input.state.localModelEnabled === true, input.state.activeLocalModels ?? {}));
    case 'localPolicy': return JSON.stringify(localSafetyPolicy(input.safetyEngine, input.hybridRemoteOnSafe, input.localSafety));
    case 'defaults': return JSON.stringify({evaluationSettings: defaultEvaluationSettings, safetyThresholds: defaultSafetyThresholds, qualityThresholds: defaultQualityThresholds});
    case 'thresholdFields': {
      if (input.kind !== 'safety' && input.kind !== 'quality') throw new Error('Invalid threshold kind.');
      return JSON.stringify(thresholdFieldRows(input.kind, input.safetyThresholds ?? {}, input.qualityThresholds ?? {}));
    }
    case 'thresholdEdit': {
      if (input.kind !== 'safety' && input.kind !== 'quality') throw new Error('Invalid threshold kind.');
      const safety = input.kind === 'safety';
      if (safety ? !moderationCategoryKeys.includes(input.key as keyof typeof defaultSafetyThresholds) : !qualityAxisKeys.includes(input.key as keyof typeof defaultQualityThresholds)) throw new Error('Invalid threshold key.');
      const fields = safety ? ['review','block'] : ['red','green'];
      if (!fields.includes(input.field)) throw new Error('Invalid threshold field.');
      const current = thresholdPair(input.current, fields[0], fields[1]);
      const defaults = safety
        ? defaultSafetyThresholds[input.key as keyof typeof defaultSafetyThresholds]
        : defaultQualityThresholds[input.key as keyof typeof defaultQualityThresholds];
      const defaultPair = thresholdPair(defaults, fields[0], fields[1]);
      if (input.reset === true) return JSON.stringify({...input.current, [input.field]: input.field === fields[0] ? defaultPair.red : defaultPair.green});
      let percent: number;
      if (input.text !== undefined) {
        if (typeof input.text !== 'string') throw new Error('Invalid threshold text.');
        const parsed = parseDualThresholdInput(input.text);
        if (parsed === null) return JSON.stringify(null);
        percent = parsed;
      } else {
        if (!Number.isInteger(input.percent) || input.percent! < 0 || input.percent! > 100) throw new Error('Invalid threshold percent.');
        percent = input.percent!;
      }
      const updated = editDualThreshold(current, input.field === fields[0] ? 'red' : 'green', percent);
      return JSON.stringify(safety
        ? {...input.current, review:updated.red, block:updated.green}
        : {...input.current, red:updated.red, green:updated.green});
    }
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
