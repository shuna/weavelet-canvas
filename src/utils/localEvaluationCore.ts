import type { LocalModerationResult, StandardQualityEvaluationResult, QualityScores, SafetyEngineMode } from '@type/evaluation';
import { qualityAxisKeys } from '@type/evaluation';

export function localModerationModelID(enabled: boolean, active: {analysis?: string | null; moderation?: string | null}): string | null {
  return enabled ? active.analysis ?? active.moderation ?? null : null;
}

/** Screening thresholds for classification scores */
const WARN_THRESHOLD = 0.5;
const BLOCK_THRESHOLD = 0.8;

/**
 * Heuristic: labels that indicate safe/acceptable content.
 * Everything else is treated as potentially negative.
 */
export function isPositiveLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    lower === 'safe' ||
    lower === 'not toxic' ||
    lower === 'acceptable' ||
    lower === 'none' ||
    lower === 'ok' ||
    lower.startsWith('not_') ||
    lower.startsWith('non_')
  );
}

// ---------------------------------------------------------------------------
// Local quality evaluation (wllama generation)
// ---------------------------------------------------------------------------

/** Per-axis prompt labels for each UI language */
const AXIS_LABELS: Record<string, Record<keyof QualityScores, { name: string; question: string }>> = {
  ja: {
    taskCompletion: { name: 'タスク達成度', question: 'この文章は求められた内容をどの程度達成していますか？' },
    faithfulness: { name: '正確性', question: 'この文章の内容は正確で事実に基づいていますか？' },
    coherence: { name: '一貫性', question: 'この文章は論理的に一貫していて読みやすいですか？' },
    conciseness: { name: '簡潔性', question: 'この文章は簡潔で無駄がないですか？' },
    instructionFollowing: { name: '指示遵守', question: 'この文章は指示や制約に従っていますか？' },
  },
  en: {
    taskCompletion: { name: 'Task Completion', question: 'Does this text adequately address what was requested?' },
    faithfulness: { name: 'Faithfulness', question: 'Is this text accurate and factually grounded?' },
    coherence: { name: 'Coherence', question: 'Is this text logically coherent and easy to follow?' },
    conciseness: { name: 'Conciseness', question: 'Is this text concise without unnecessary content?' },
    instructionFollowing: { name: 'Instruction Following', question: 'Does this text follow the given instructions and constraints?' },
  },
};

function getAxisLabels(language: string): Record<keyof QualityScores, { name: string; question: string }> {
  if (language.startsWith('ja')) return AXIS_LABELS.ja;
  return AXIS_LABELS.en;
}

/**
 * Build a per-axis evaluation prompt.
 */
function buildAxisPrompt(text: string, axisQuestion: string, assistantResponse: string | undefined, language: string): string {
  if (language.startsWith('ja')) {
    if (assistantResponse) {
      return `以下の会話コンテキストとアシスタントの応答について答えてください。\n\nコンテキスト: ${text}\n\nアシスタントの応答: ${assistantResponse}\n\n質問: ${axisQuestion}\n\n回答:`;
    }
    return `以下のテキストについて答えてください。\n\nテキスト: ${text}\n\n質問: ${axisQuestion}\n\n回答:`;
  }
  if (assistantResponse) {
    return `Answer about this conversation context and assistant response.\n\nContext: ${text}\n\nAssistant response: ${assistantResponse}\n\nQuestion: ${axisQuestion}\n\nAnswer:`;
  }
  return `Answer about this text.\n\nText: ${text}\n\nQuestion: ${axisQuestion}\n\nAnswer:`;
}

/**
 * Estimate a score from a short evaluation text using sentiment cues.
 */
export function estimateScoreFromText(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  const rawText = raw.trim();
  const positiveEN = (trimmed.match(/\b(good|great|excellent|well|clear|strong|effective|accurate|concise|yes|adequate|follows)\b/g) || []).length;
  const negativeEN = (trimmed.match(/\b(poor|bad|weak|unclear|confusing|verbose|wrong|inaccurate|lacks?|missing|no|does not|doesn't|fail)\b/g) || []).length;
  const positiveJA = (rawText.match(/(良い|優れ|適切|明確|分かりやすい|簡潔|正確|的確|効果的|丁寧|はい|従って|達成)/g) || []).length;
  const negativeJA = (rawText.match(/(悪い|不適切|不明確|冗長|不正確|曖昧|不足|欠け|問題|いいえ|従っていない|達成していない)/g) || []).length;
  const pos = positiveEN + positiveJA;
  const neg = negativeEN + negativeJA;
  if (pos > neg + 1) return 0.75;
  if (pos > neg) return 0.65;
  if (neg > pos + 1) return 0.30;
  if (neg > pos) return 0.45;
  return 0.55;
}

// Mapping from natural axis names to QualityScores keys
const AXIS_NAME_MAP: Record<string, keyof QualityScores> = {
  'task completion': 'taskCompletion',
  'taskcompletion': 'taskCompletion',
  'task_completion': 'taskCompletion',
  'タスク達成': 'taskCompletion',
  'faithfulness': 'faithfulness',
  '正確性': 'faithfulness',
  '忠実性': 'faithfulness',
  'coherence': 'coherence',
  '一貫性': 'coherence',
  'conciseness': 'conciseness',
  '簡潔性': 'conciseness',
  'instruction following': 'instructionFollowing',
  'instructionfollowing': 'instructionFollowing',
  'instruction_following': 'instructionFollowing',
  '指示遵守': 'instructionFollowing',
};

/**
 * Parse local model output into a StandardQualityEvaluationResult.
 * Three-tier parser: JSON → line-by-line regex → grade fallback.
 */
export function parseLocalQualityResponse(raw: string, now: number): StandardQualityEvaluationResult {
  const defaultScores = (): QualityScores => ({
    taskCompletion: 0,
    faithfulness: 0,
    coherence: 0,
    conciseness: 0,
    instructionFollowing: 0,
  });

  // --- Tier 1: JSON ---
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    const jsonStr = jsonMatch[1]?.trim() ?? raw.trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.scores === 'object') {
      const scores = defaultScores();
      const reasoning: Partial<Record<keyof QualityScores, string>> = {};
      for (const key of qualityAxisKeys) {
        const val = parsed.scores[key];
        if (typeof val === 'number') {
          scores[key] = val > 1 ? val / 10 : Math.min(1, Math.max(0, val));
        }
        if (parsed.reasoning?.[key]) {
          reasoning[key] = String(parsed.reasoning[key]);
        }
      }
      return {
        kind: 'standard',
        scores,
        reasoning,
        promptSuggestions: Array.isArray(parsed.promptSuggestions) ? parsed.promptSuggestions.map(String) : [],
        configSuggestions: Array.isArray(parsed.configSuggestions) ? parsed.configSuggestions.map(String) : [],
        source: 'local',
        timestamp: now,
      };
    }
  } catch {
    // Not valid JSON, proceed to Tier 2
  }

  // --- Tier 2: Line-by-line regex ---
  {
    const scores = defaultScores();
    const reasoning: Partial<Record<keyof QualityScores, string>> = {};
    let foundAxes = 0;

    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();

      for (const [name, key] of Object.entries(AXIS_NAME_MAP)) {
        if (lineLower.includes(name)) {
          const scoreMatch = line.match(/[\s:]+(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/);
          if (scoreMatch) {
            let val = parseFloat(scoreMatch[1]);
            if (val > 1) val = val / 10;
            scores[key] = Math.min(1, Math.max(0, val));
            foundAxes++;

            const afterScore = line.slice((scoreMatch.index ?? 0) + scoreMatch[0].length).trim();
            const reasonText = afterScore.replace(/^[-–—:.\s]+/, '').trim();
            if (reasonText.length > 5) {
              reasoning[key] = reasonText;
            } else if (i + 1 < lines.length) {
              const nextLine = lines[i + 1].trim().replace(/^[-–—:.\s]+/, '').trim();
              if (nextLine && !Object.keys(AXIS_NAME_MAP).some(n => nextLine.toLowerCase().includes(n))) {
                reasoning[key] = nextLine;
              }
            }
          }
          break;
        }
      }
    }

    if (foundAxes >= 3) {
      const promptSuggestions: string[] = [];
      const configSuggestions: string[] = [];
      let currentSection: 'prompt' | 'config' | null = null;

      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes('prompt') && lower.includes('suggest')) {
          currentSection = 'prompt';
          continue;
        }
        if (lower.includes('config') && lower.includes('suggest') || lower.includes('recommendation')) {
          currentSection = 'config';
          continue;
        }
        const bullet = line.match(/^\s*[-*•]\s+(.+)/);
        if (bullet && currentSection === 'prompt') promptSuggestions.push(bullet[1].trim());
        if (bullet && currentSection === 'config') configSuggestions.push(bullet[1].trim());
      }

      return {
        kind: 'standard',
        scores,
        reasoning,
        promptSuggestions,
        configSuggestions,
        source: 'local',
        timestamp: now,
      };
    }
  }

  // --- Tier 3: Free-text fallback ---
  const trimmed = raw.trim().toLowerCase();
  const rawText = raw.trim();

  // Estimate a rough score from sentiment cues in the text (EN + JA)
  let uniformScore = 0.55;
  const positiveEN = (trimmed.match(/\b(good|great|excellent|well|clear|strong|effective|accurate|concise)\b/g) || []).length;
  const negativeEN = (trimmed.match(/\b(poor|bad|weak|unclear|confusing|verbose|wrong|inaccurate|lacks?|missing)\b/g) || []).length;
  const positiveJA = (rawText.match(/(良い|優れ|適切|明確|分かりやすい|簡潔|正確|的確|効果的|丁寧)/g) || []).length;
  const negativeJA = (rawText.match(/(悪い|不適切|不明確|冗長|不正確|曖昧|不足|欠け|問題)/g) || []).length;
  const positiveWords = positiveEN + positiveJA;
  const negativeWords = negativeEN + negativeJA;
  if (positiveWords > negativeWords + 1) uniformScore = 0.75;
  else if (positiveWords > negativeWords) uniformScore = 0.65;
  else if (negativeWords > positiveWords + 1) uniformScore = 0.30;
  else if (negativeWords > positiveWords) uniformScore = 0.45;

  const uniformScores = defaultScores();
  for (const key of qualityAxisKeys) {
    uniformScores[key] = uniformScore;
  }

  // Show the raw evaluation text under each axis individually
  const tier3Reasoning: Partial<Record<keyof QualityScores, string>> = {};
  if (rawText) {
    for (const key of qualityAxisKeys) {
      tier3Reasoning[key] = rawText;
    }
  }

  return {
    kind: 'standard',
    scores: uniformScores,
    reasoning: tier3Reasoning,
    promptSuggestions: [],
    configSuggestions: [],
    source: 'local',
    timestamp: now,
  };
}


export function localAxisPrompt(axis: keyof QualityScores, text: string, assistantResponse: string | undefined, language: string) {
  const label = getAxisLabels(language)[axis];
  const inputText = text.slice(0, 400);
  const inputAssistant = assistantResponse?.slice(0, 400);
  return {
    prompt: buildAxisPrompt(inputText, label.question, inputAssistant, language),
    fallback: language.startsWith('ja')
      ? `「${inputText.slice(0, 150)}」\n${label.name}の評価:`
      : `"${inputText.slice(0, 150)}"\n${label.name}:`,
    options: {maxTokens: 400, temperature: 0.2},
    fallbackOptions: {maxTokens: 200, temperature: 0.5},
  };
}

export function localAxisScore(raw: string): {score: number; reasoning?: string} {
  const trimmed = raw.trim();
  return trimmed ? {score: estimateScoreFromText(trimmed), reasoning: trimmed} : {score: 0.5};
}

export function localQualityResult(outputs: Partial<Record<keyof QualityScores, string>>, now: number): StandardQualityEvaluationResult {
  const scores = {} as QualityScores;
  const reasoning: Partial<Record<keyof QualityScores, string>> = {};
  for (const axis of qualityAxisKeys) {
    const result = localAxisScore(outputs[axis] ?? '');
    scores[axis] = result.score;
    if (result.reasoning) reasoning[axis] = result.reasoning;
  }
  return {kind: 'standard', scores, reasoning, promptSuggestions: [], configSuggestions: [], source: 'local', timestamp: now};
}

export function localModeration(labels: {label: string; score: number}[], now: number): LocalModerationResult {
  const negativeLabels = labels.filter(l => !isPositiveLabel(l.label));
  const maxNegativeScore = negativeLabels.length > 0 ? Math.max(...negativeLabels.map(l => l.score)) : 0;
  let screening: LocalModerationResult['screening'] = 'safe';
  if (maxNegativeScore >= BLOCK_THRESHOLD) screening = 'block-candidate';
  else if (maxNegativeScore >= WARN_THRESHOLD) screening = 'warn';
  return {screening, rawScores: labels.map(l => ({label: l.label, score: l.score})), source: 'local', timestamp: now};
}

export function localSafetyPolicy(safetyEngine: SafetyEngineMode, hybridRemoteOnSafe: boolean, localSafety?: LocalModerationResult): {runLocal: boolean; runRemote: boolean} {
  return {
    runLocal: safetyEngine === 'local' || safetyEngine === 'hybrid',
    runRemote: safetyEngine === 'remote' ||
      (safetyEngine === 'local' && !localSafety) ||
      (safetyEngine === 'hybrid' && (
        localSafety?.screening === 'warn' || localSafety?.screening === 'block-candidate' || hybridRemoteOnSafe || !localSafety
      )),
  };
}
