import { assertAuxiliaryEndpoint, hardOpenRouterConstraints } from '@utils/openrouterControls';
import type { OpenRouterChatSettings } from '@type/chat';
import i18next from 'i18next';
/**
 * Evaluation API utilities:
 * A) Safety check via OpenAI-compatible Moderation API
 * B) Quality evaluation via LLM-as-Judge (chat completion)
 */

import type { SafetyCheckResult, QualityEvaluationResult, QualityEvaluationMode } from '@type/evaluation';
import useStore from '@store/store';
import { buildJudgeRequest, buildSafetyRequest, parseJudgeResponse, parseSafetyResponse } from '@utils/evaluationCore';
import { DEFAULT_PROVIDERS } from '@store/provider-config';
import { getProxyConfig, fetchViaProxy, runModerationViaProxy } from '@utils/proxyClient';

// ---------------------------------------------------------------------------
// A) Safety Check — OpenAI Moderation API
// ---------------------------------------------------------------------------

/**
 * Call the OpenAI Moderation endpoint (or compatible).
 * Falls back to the provider's base endpoint + /moderations path.
 */
/**
 * Derive the base URL from a chat completions endpoint.
 * e.g. "https://api.openai.com/v1/chat/completions" → "https://api.openai.com/v1"
 *      "https://openrouter.ai/api/v1/chat/completions" → "https://openrouter.ai/api/v1"
 *      "https://api.openai.com/v1" → "https://api.openai.com/v1"
 */
function deriveBaseUrl(endpoint: string): string {
  return endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
}

/**
 * Resolve the OpenAI API key from the provider store.
 * Safety checks always use OpenAI's Moderation API regardless of the chat model.
 */
export function resolveOpenAiCredentials(): { endpoint: string; apiKey: string } {
  const state = useStore.getState();
  const openaiProvider = state.providers?.openai;
  const apiKey = openaiProvider?.apiKey;
  if (!apiKey) {
    throw new Error('[EVAL_API_KEY_REQUIRED]');
  }
  const endpoint = openaiProvider?.endpoint ?? DEFAULT_PROVIDERS.openai.endpoint;
  return { endpoint, apiKey };
}

/**
 * Run safety check via OpenAI Moderation API.
 * Always uses the OpenAI provider regardless of the current chat model/provider.
 */
export async function runSafetyCheck(
  text: string,
  openRouter?: OpenRouterChatSettings,
  signal?: AbortSignal,
): Promise<SafetyCheckResult> {
  if (hardOpenRouterConstraints(openRouter)) throw new Error(i18next.t('model:openRouter.errors.safety') as string);
  const { endpoint, apiKey } = resolveOpenAiCredentials();
  const moderation = buildSafetyRequest({endpoint, text, openRouter});
  const moderationUrl = moderation.endpoint;
  const { proxyEndpoint, proxyAuthToken } = useStore.getState();

  if (!proxyEndpoint) {
    throw new Error('[EVAL_PROXY_NOT_CONFIGURED]');
  }

  const response = await runModerationViaProxy(
    {
      endpoint: proxyEndpoint.replace(/\/+$/, ''),
      authToken: proxyAuthToken || undefined,
    },
    {
      endpoint: moderationUrl,
      apiKey,
      input: moderation.body.input,
    },
    signal
  ).catch((e) => {
    throw new Error(`[EVAL_CONNECTION_FAILED] url=${moderationUrl} detail=${e.message}`);
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 404) {
      throw new Error(`[EVAL_MODERATION_NOT_FOUND] url=${moderationUrl} detail=${detail}`);
    }
    throw new Error(`[EVAL_MODERATION_API_ERROR] status=${response.status} url=${moderationUrl} detail=${detail}`);
  }

  const data = await response.json();
  return parseSafetyResponse(data, Date.now());
}

// ---------------------------------------------------------------------------
// B) Quality Evaluation — LLM-as-Judge
// ---------------------------------------------------------------------------

/**
 * Run quality evaluation using a chat completion endpoint (LLM-as-Judge).
 */
export async function runQualityEvaluation(
  userPrompt: string,
  assistantResponse: string | undefined,
  endpoint: string,
  model: string,
  apiKey?: string,
  language?: string,
  evaluationMode?: QualityEvaluationMode,
  openRouter?: OpenRouterChatSettings,
  signal?: AbortSignal
): Promise<QualityEvaluationResult> {
  const proxyConfig = getProxyConfig();
  const chatUrl = endpoint.includes('/chat/completions') ? endpoint : deriveBaseUrl(endpoint) + '/chat/completions';
  assertAuxiliaryEndpoint(openRouter, chatUrl);
  const { headers, body } = buildJudgeRequest({userPrompt, assistantResponse, endpoint, model, apiKey, language, mode: evaluationMode, openRouter, viaProxy: !!proxyConfig});
  const response = await fetchViaProxy(proxyConfig, chatUrl, headers, body, signal).catch((e) => {
    throw new Error(`[EVAL_QUALITY_CONNECTION_FAILED] url=${chatUrl} detail=${e.message}`);
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`[EVAL_QUALITY_API_ERROR] status=${response.status} url=${chatUrl} detail=${detail}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('[EVAL_QUALITY_EMPTY_RESPONSE]');

  const result = parseJudgeResponse(content, evaluationMode);
  return { ...result, timestamp: Date.now() } as QualityEvaluationResult;
}
