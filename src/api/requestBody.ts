import type { ConfigInterface, MessageInterface, ReasoningEffort } from '@type/chat';
import {
  isOpenRouterAdaptiveReasoningModel,
  isOpenRouterClaudeEffortModel,
  getEffectiveVerbosity,
  isOpenRouterClaudeVerbosityModel,
  supportsMaxVerbosity,
} from '@utils/reasoning';

/** Effort values only supported by OpenRouter's unified reasoning API. */
const OPENROUTER_ONLY_EFFORTS: ReadonlySet<ReasoningEffort> = new Set([
  'none', 'minimal', 'xhigh',
]);

/**
 * Models that only support reasoning.max_tokens (not reasoning.effort).
 * When effort-only is configured, we map effort to a default max_tokens value.
 */
const needsMaxTokensOnly = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return id.includes('claude');
};

/** Map effort level to a reasonable default max_tokens for models that don't support effort. */
const EFFORT_TO_MAX_TOKENS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
};

/**
 * Build the API-ready body from ConfigInterface.
 * Strips client-only fields and conditionally includes reasoning parameters
 * in the format expected by the target provider.
 */
export const buildRequestBody = (
  messages: MessageInterface[],
  config: ConfigInterface,
  capabilities: { supportsReasoning: boolean; requiresReasoning: boolean },
  overrides?: Record<string, unknown>
): Record<string, unknown> => {
  const {
    providerId,
    reasoning_effort,
    reasoning_budget_tokens,
    verbosity,
    force_reasoning,
    modelSettings,
    openRouter,
    systemPrompt,
    modelSource,
    ...apiConfig
  } = config;

  const body: Record<string, unknown> = {
    messages: messages.map(({ role, content }) => ({ role, content })),
    ...apiConfig,
    max_tokens: config.max_tokens > 0 ? config.max_tokens : undefined,
    ...overrides,
  };

  // Only include reasoning params when the model supports reasoning, or
  // when the user explicitly forces them (e.g. a new model not yet detected)
  if (capabilities.supportsReasoning || force_reasoning) {
    if (providerId === 'openrouter') {
      // OpenRouter unified reasoning object
      const reasoning: Record<string, unknown> = {};
      const isEffortClaude = isOpenRouterClaudeEffortModel(config.model, providerId);
      if (reasoning_effort === 'none') {
        if (capabilities.requiresReasoning) {
          reasoning.effort = 'low';
        } else {
          reasoning.enabled = false;
        }
      } else if (reasoning_budget_tokens && reasoning_budget_tokens > 0 && !isEffortClaude) {
        // Explicit budget takes precedence — except on Claude 4.7+/Fable,
        // where budget_tokens is removed and effort is the supported control
        reasoning.max_tokens = reasoning_budget_tokens;
      } else if (reasoning_effort) {
        if (isEffortClaude) {
          // "minimal" doesn't exist on Anthropic's effort scale — clamp to low
          reasoning.effort =
            reasoning_effort === 'minimal' ? 'low' : reasoning_effort;
        } else if (isOpenRouterAdaptiveReasoningModel(config.model, providerId)) {
          reasoning.enabled = true;
        } else if (needsMaxTokensOnly(config.model)) {
          // Claude etc. only support max_tokens, not effort — convert
          const mapped = EFFORT_TO_MAX_TOKENS[reasoning_effort];
          if (mapped > 0) reasoning.max_tokens = mapped;
        } else {
          reasoning.effort = reasoning_effort;
        }
      }
      if (Object.keys(reasoning).length > 0) {
        body.reasoning = reasoning;
      }
    } else {
      // Other providers: top-level params, skip OpenRouter-only values
      if (reasoning_effort && !OPENROUTER_ONLY_EFFORTS.has(reasoning_effort)) {
        body.reasoning_effort = reasoning_effort;
      }
      if (reasoning_budget_tokens && reasoning_budget_tokens > 0) {
        body.reasoning_budget_tokens = reasoning_budget_tokens;
      }
    }
  }

  if (isOpenRouterClaudeVerbosityModel(config.model, providerId) && verbosity) {
    body.verbosity = getEffectiveVerbosity(verbosity, supportsMaxVerbosity(config.model, providerId));
  }

  return body;
};

