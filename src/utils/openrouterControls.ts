import i18next from 'i18next';
import useStore from '@store/store';
import type { ConfigInterface, OpenRouterChatSettings, OpenRouterObservation } from '@type/chat';
import { isOpenRouterURL, hardOpenRouterConstraints, applyOpenRouterControls as applyControls, type OpenRouterRequestContext } from './openrouterRequest';
export { validateOpenRouterSettings, hardOpenRouterConstraints } from './openrouterRequest';
export type { OpenRouterRequestContext } from './openrouterRequest';

export const isOpenRouterEndpoint = (endpoint: string): boolean => {
  try {
    const url = new URL(endpoint);
    return isOpenRouterURL(url);
  } catch { return false; }
};

export function canUseOpenRouterResponseCache(): boolean {
  const state = useStore.getState();
  return state.proxyEnabled && !!state.proxyEndpoint?.trim();
}

export function assertAuxiliaryEndpoint(settings: OpenRouterChatSettings | undefined, endpoint: string): void {
  if (hardOpenRouterConstraints(settings) && !isOpenRouterEndpoint(endpoint)) throw new Error(i18next.t('model:openRouter.errors.auxiliary') as string);
}

export function applyOpenRouterControls(endpoint: string, config: ConfigInterface, body: Record<string, unknown>, headers: Record<string, string>, context?: OpenRouterRequestContext): void {
  applyControls(isOpenRouterEndpoint(endpoint), config, body, headers, context);
}

export function observeOpenRouterHeaders(headers: Headers): OpenRouterObservation {
  const o: OpenRouterObservation = {};
  const status = headers.get('X-OpenRouter-Cache-Status');
  if (status === 'HIT' || status === 'MISS') o.responseCacheStatus = status;
  for (const [field, header] of [['responseCacheAge', 'X-OpenRouter-Cache-Age'], ['responseCacheTTL', 'X-OpenRouter-Cache-TTL']] as const) {
    const raw = headers.get(header);
    if (raw !== null && raw.trim() && Number.isFinite(Number(raw))) o[field] = Number(raw);
  }
  const source = headers.get('X-OpenRouter-Cache-Source-Id');
  if (source) o.responseCacheSourceId = source;
  const id = headers.get('X-Generation-Id');
  if (id) o.generationId = id;
  return o;
}

export function observeOpenRouterUsage(usage: unknown): OpenRouterObservation {
  if (!usage || typeof usage !== 'object') return {};
  const u = usage as Record<string, unknown>;
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const observation: OpenRouterObservation = {};
  for (const [field, v] of Object.entries({ promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, cost: u.cost, cachedTokens: details?.cached_tokens, cacheWriteTokens: details?.cache_write_tokens })) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) Object.assign(observation, { [field]: v });
  }
  return observation;
}
