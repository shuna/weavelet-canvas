import type { OpenRouterChatSettings } from '@type/chat';
import { applyOpenRouterControls, hardOpenRouterConstraints, isOpenRouterURL } from './openrouterRequest';
import type { QualityEvaluationResult, QualityScores, SystemQualityScores, QualityEvaluationMode } from '@type/evaluation';
import { qualityAxisKeys, systemQualityAxisKeys } from '@type/evaluation';

const QUALITY_SYSTEM_PROMPT = `You are an expert evaluation judge. You will receive a user prompt and an AI response. Evaluate the response quality on these 5 axes (score 0.0-1.0 each):

1. taskCompletion: Does the response address everything the prompt asked for?
2. faithfulness: Is the response factually grounded and free of hallucinations?
3. coherence: Is the response logically consistent and well-structured?
4. conciseness: Is the response appropriately brief without unnecessary content?
5. instructionFollowing: Does the response obey explicit constraints (format, language, length, etc.)?

Also provide:
- promptSuggestions: concrete ways the user could improve their prompt
- configSuggestions: recommendations for model or parameter changes

Respond ONLY with valid JSON in this exact format:
{
  "scores": { "taskCompletion": 0.0, "faithfulness": 0.0, "coherence": 0.0, "conciseness": 0.0, "instructionFollowing": 0.0 },
  "reasoning": { "taskCompletion": "...", "faithfulness": "...", "coherence": "...", "conciseness": "...", "instructionFollowing": "..." },
  "promptSuggestions": ["..."],
  "configSuggestions": ["..."]
}`;

const QUALITY_PROMPT_ONLY_SYSTEM = `You are an expert prompt evaluation judge. You will receive a user prompt BEFORE it is sent to an AI. Evaluate the prompt quality and predict potential issues. Score these 5 axes (0.0-1.0) based on how well the prompt is crafted:

1. taskCompletion: Is the prompt clear enough to get a complete response?
2. faithfulness: Does the prompt provide enough context for a grounded response?
3. coherence: Is the prompt itself logically structured?
4. conciseness: Is the prompt appropriately brief without missing information?
5. instructionFollowing: Does the prompt include explicit constraints (format, language, etc.)?

Also provide:
- promptSuggestions: concrete ways to improve this prompt before sending
- configSuggestions: recommendations for model or parameter choices

Respond ONLY with valid JSON in this exact format:
{
  "scores": { "taskCompletion": 0.0, "faithfulness": 0.0, "coherence": 0.0, "conciseness": 0.0, "instructionFollowing": 0.0 },
  "reasoning": { "taskCompletion": "...", "faithfulness": "...", "coherence": "...", "conciseness": "...", "instructionFollowing": "..." },
  "promptSuggestions": ["..."],
  "configSuggestions": ["..."]
}`;

const QUALITY_SYSTEM_ROLE_PROMPT = `You are an expert evaluation judge for AI system prompts. You will receive a system prompt used to configure an AI assistant. Evaluate the system prompt quality on these 5 axes (score 0.0-1.0 each):

1. roleClarity: Does the system prompt clearly define the assistant's role and persona?
2. constraintConsistency: Are the constraints, priorities, and rules internally consistent?
3. safetyAdequacy: Are safety constraints appropriate and well-defined?
4. conciseness: Is the prompt appropriately brief without unnecessary redundancy?
5. operability: Is the prompt practical and easy to maintain in production?

Also provide:
- promptSuggestions: concrete ways to improve this system prompt
- configSuggestions: recommendations for model or parameter changes

Respond ONLY with valid JSON in this exact format:
{
  "scores": { "roleClarity": 0.0, "constraintConsistency": 0.0, "safetyAdequacy": 0.0, "conciseness": 0.0, "operability": 0.0 },
  "reasoning": { "roleClarity": "...", "constraintConsistency": "...", "safetyAdequacy": "...", "conciseness": "...", "operability": "..." },
  "promptSuggestions": ["..."],
  "configSuggestions": ["..."]
}`;

function buildSystemJudgeMessages(
  systemPromptText: string,
  conversationContext?: string,
  language?: string
): Array<{ role: string; content: string }> {
  const langInstruction = language && language !== 'en'
    ? `\n\nIMPORTANT: Write ALL reasoning, promptSuggestions, and configSuggestions text in ${language}. The JSON keys must remain in English.`
    : '';
  const evalSystemPrompt = QUALITY_SYSTEM_ROLE_PROMPT + langInstruction;

  let userContent = `## System Prompt to Evaluate\n${systemPromptText}`;
  if (conversationContext) {
    userContent += `\n\n## Conversation Context\n${conversationContext}`;
  }

  return [
    { role: 'system', content: evalSystemPrompt },
    { role: 'user', content: userContent },
  ];
}

export function buildJudgeMessages(
  userPrompt: string,
  assistantResponse?: string,
  language?: string
): Array<{ role: string; content: string }> {
  const isPreSend = !assistantResponse;
  const basePrompt = isPreSend ? QUALITY_PROMPT_ONLY_SYSTEM : QUALITY_SYSTEM_PROMPT;
  const langInstruction = language && language !== 'en'
    ? `\n\nIMPORTANT: Write ALL reasoning, promptSuggestions, and configSuggestions text in ${language}. The JSON keys must remain in English.`
    : '';
  const systemPrompt = basePrompt + langInstruction;

  const userContent = isPreSend
    ? `## User Prompt\n${userPrompt}`
    : `## User Prompt\n${userPrompt}\n\n## AI Response\n${assistantResponse}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

export function parseJudgeResponse(text: string, mode?: QualityEvaluationMode): Omit<QualityEvaluationResult, 'timestamp'> {
  // Extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const jsonStr = jsonMatch[1]?.trim() ?? text.trim();

  const parsed = JSON.parse(jsonStr);

  if (mode === 'system') {
    const scores: SystemQualityScores = {
      roleClarity: 0,
      constraintConsistency: 0,
      safetyAdequacy: 0,
      conciseness: 0,
      operability: 0,
    };
    for (const key of systemQualityAxisKeys) {
      const val = parsed.scores?.[key];
      if (typeof val === 'number' && val >= 0 && val <= 1) {
        scores[key] = val;
      }
    }
    return {
      kind: 'system',
      scores,
      reasoning: parsed.reasoning ?? {},
      promptSuggestions: Array.isArray(parsed.promptSuggestions) ? parsed.promptSuggestions : [],
      configSuggestions: Array.isArray(parsed.configSuggestions) ? parsed.configSuggestions : [],
    };
  }

  const scores: QualityScores = {
    taskCompletion: 0,
    faithfulness: 0,
    coherence: 0,
    conciseness: 0,
    instructionFollowing: 0,
  };

  for (const key of qualityAxisKeys) {
    const val = parsed.scores?.[key];
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      scores[key] = val;
    }
  }

  return {
    kind: 'standard',
    scores,
    reasoning: parsed.reasoning ?? {},
    promptSuggestions: Array.isArray(parsed.promptSuggestions) ? parsed.promptSuggestions : [],
    configSuggestions: Array.isArray(parsed.configSuggestions) ? parsed.configSuggestions : [],
  };
}

export function buildQualityJudgeMessages(userPrompt: string, assistantResponse?: string, language?: string, mode?: QualityEvaluationMode): Array<{role: string; content: string}> {
  return mode === 'system' ? buildSystemJudgeMessages(userPrompt, assistantResponse, language) : buildJudgeMessages(userPrompt, assistantResponse, language);
}

export function parseSafetyResponse(data: {results?: Array<{flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number>}>}, now: number) {
  const result = data.results?.[0];
  if (!result) throw new Error('[EVAL_MODERATION_EMPTY_RESULTS]');
  return { flagged: result.flagged ?? false, categories: result.categories ?? {}, categoryScores: result.category_scores ?? {}, timestamp: now };
}

export function buildJudgeRequest(input: {userPrompt: string; assistantResponse?: string; endpoint: string; model: string; apiKey?: string; language?: string; mode?: QualityEvaluationMode; openRouter?: OpenRouterChatSettings; viaProxy?: boolean; endpointURL?: {protocol: string; hostname: string}}) {
  if (!input.model) throw new Error('[EVAL_MODEL_NOT_SELECTED]');
  const chatUrl = input.endpoint.includes('/chat/completions') ? input.endpoint : input.endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '') + '/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
  const body: Record<string, unknown> = {
    model: input.model,
    messages: buildQualityJudgeMessages(input.userPrompt, input.assistantResponse, input.language, input.mode),
    temperature: 0,
    max_tokens: 2048,
  };
  if (/openai\.com|openrouter\.ai|together\.xyz|fireworks\.ai|groq\.com|mistral\.ai|deepinfra\.com/i.test(chatUrl)) body.response_format = { type: 'json_object' };
  let isOpenRouter = false;
  if (input.endpointURL) isOpenRouter = isOpenRouterURL(input.endpointURL);
  else try { isOpenRouter = isOpenRouterURL(new URL(chatUrl)); } catch { /* endpoint validation stays with transport */ }
  applyOpenRouterControls(isOpenRouter, { model: input.model, max_tokens: 0, temperature: 0, top_p: 1, presence_penalty: 0, frequency_penalty: 0, openRouter: { routing: hardOpenRouterConstraints(input.openRouter), responseCache: { mode: 'off' } } } as Parameters<typeof applyOpenRouterControls>[1], body, headers, { auxiliary: true, viaProxy: input.viaProxy ?? false });
  return { chatUrl, headers, body };
}

export function buildSafetyRequest(input: {endpoint: string; text: string; openRouter?: OpenRouterChatSettings}) {
  if (hardOpenRouterConstraints(input.openRouter)) throw new Error('[EVAL_SAFETY_OPENROUTER_CONSTRAINTS]');
  return {
    endpoint: input.endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '') + '/moderations',
    headers: {'Content-Type': 'application/json'},
    body: {input: input.text},
  };
}
