import i18next from 'i18next';
import useStore from '@store/store';
import type { ConfigInterface, MessageInterface, OpenRouterChatSettings, OpenRouterObservation } from '@type/chat';

export interface OpenRouterRequestContext {
  chatId?: string;
  regenerate?: boolean;
  auxiliary?: boolean;
  viaProxy?: boolean;
  onObservation?: (observation: OpenRouterObservation) => void;
}

export const isOpenRouterEndpoint = (endpoint: string): boolean => {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && ['openrouter.ai', 'eu.openrouter.ai', 'us.openrouter.ai'].includes(url.hostname);
  } catch { return false; }
};

export function canUseOpenRouterResponseCache(streamEnabled = true): boolean {
  const state = useStore.getState();
  return streamEnabled && state.proxyEnabled && !!state.proxyEndpoint?.trim();
}

export function validateOpenRouterSettings(settings: OpenRouterChatSettings | undefined, model?: string, responseCacheEnabled = true): string | undefined {
  if (settings === undefined) return;
  const object = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!object(settings) || [settings.routing, settings.promptCache, ...(responseCacheEnabled ? [settings.responseCache] : [])].some(v => v !== undefined && !object(v))) return 'openRouter.errors.invalid';
  const r = settings.routing;
  if (r) {
    if (r.max_price !== undefined && !object(r.max_price)) return 'openRouter.errors.price';
    for (const list of [r.order, r.only, r.ignore]) {
      if (list !== undefined && (!Array.isArray(list) || list.some(v => typeof v !== 'string' || !v.trim()) || new Set(list).size !== list.length)) return 'openRouter.errors.slugs';
    }
    if ([...(r.order ?? []), ...(r.only ?? [])].some(v => r.ignore?.includes(v)) || r.order?.some(v => r.only?.length && !r.only.includes(v))) return 'openRouter.errors.conflict';
    if (r.order?.length && r.sort) return 'openRouter.errors.conflict';
    if (r.sort !== undefined && !['price', 'throughput', 'latency'].includes(r.sort)) return 'openRouter.errors.invalid';
    if (r.data_collection !== undefined && !['allow', 'deny'].includes(r.data_collection)) return 'openRouter.errors.invalid';
    for (const v of [r.allow_fallbacks, r.require_parameters, r.zdr]) if (v !== undefined && typeof v !== 'boolean') return 'openRouter.errors.invalid';
    for (const v of [r.max_price?.prompt, r.max_price?.completion]) if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return 'openRouter.errors.price';
  }
  if (settings.stickySession !== undefined && typeof settings.stickySession !== 'boolean') return 'openRouter.errors.invalid';
  const p = settings.promptCache;
  if (p) {
    if (!['provider-default', 'claude-conversation', 'claude-system'].includes(p.mode) || (p.ttl !== undefined && !['5m', '1h'].includes(p.ttl))) return 'openRouter.errors.invalid';
    if (p.mode !== 'provider-default' && model !== undefined && !model.startsWith('anthropic/claude-')) return 'openRouter.errors.model';
  }
  const c = settings.responseCache;
  if (c && responseCacheEnabled) {
    if (!['inherit', 'off', 'on'].includes(c.mode)) return 'openRouter.errors.invalid';
    if (c.ttlSeconds !== undefined && (!Number.isInteger(c.ttlSeconds) || c.ttlSeconds < 1 || c.ttlSeconds > 86400)) return 'openRouter.errors.ttl';

  }
}

export function hardOpenRouterConstraints(settings?: OpenRouterChatSettings): OpenRouterChatSettings['routing'] {
  const error = validateOpenRouterSettings(settings, undefined, false);
  if (error) throw new Error(i18next.t(`model:${error}`) as string);
  const r = settings?.routing;
  if (!r) return;
  const constrained = {
    only: r.only?.length ? [...r.only] : undefined,
    ignore: r.ignore?.length ? [...r.ignore] : undefined,
    max_price: r.max_price && Object.values(r.max_price).some(v => v !== undefined) ? { ...r.max_price } : undefined,
    data_collection: r.data_collection === 'deny' ? 'deny' as const : undefined,
    zdr: r.zdr === true ? true : undefined,
  };
  return Object.values(constrained).some(v => v !== undefined) ? constrained : undefined;
}

export function assertAuxiliaryEndpoint(settings: OpenRouterChatSettings | undefined, endpoint: string): void {
  if (hardOpenRouterConstraints(settings) && !isOpenRouterEndpoint(endpoint)) throw new Error(i18next.t('model:openRouter.errors.auxiliary') as string);
}

export function applyOpenRouterControls(
  endpoint: string, config: ConfigInterface, body: Record<string, unknown>, headers: Record<string, string>, context?: OpenRouterRequestContext
): void {
  const settings = config.openRouter;
  if (!isOpenRouterEndpoint(endpoint)) {
    if (settings && config.providerId === 'openrouter') throw new Error(i18next.t('model:openRouter.errors.endpoint') as string);
    return;
  }
  const error = validateOpenRouterSettings(settings, config.model, context?.viaProxy === true);
  if (error) throw new Error(i18next.t(`model:${error}`) as string);
  const routing = context?.auxiliary ? hardOpenRouterConstraints(settings) : settings?.routing;
  if (routing) {
    const { order, only, ignore, sort, allow_fallbacks, require_parameters, max_price, data_collection, zdr } = routing;
    body.provider = { order, only, ignore, sort, allow_fallbacks, require_parameters, max_price, data_collection, zdr };
  }
  if (context?.chatId && settings?.stickySession) body.session_id = `weavelet:${context.chatId}${context.auxiliary ? ':title' : ''}`;
  const p = context?.auxiliary ? undefined : settings?.promptCache;
  if (p && p.mode !== 'provider-default') {
    const cache = { type: 'ephemeral', ...(p.ttl === '1h' ? { ttl: '1h' } : {}) };
    if (p.mode === 'claude-conversation') body.cache_control = cache;
    else {
      const messages = body.messages as MessageInterface[];
      const index = messages.findIndex(m => m.role === 'system');
      const message = messages[index];
      const lastText = message?.content.map(c => c.type).lastIndexOf('text') ?? -1;
      if (lastText < 0) throw new Error(i18next.t('model:openRouter.errors.system') as string);
      body.messages = messages.map((m, i) => i !== index ? m : {
        ...m, content: m.content.map((c, j) => j !== lastText ? c : { ...c, cache_control: cache }),
      });
    }
  }
  if (!context?.viaProxy) return;
  const c = settings?.responseCache;
  if (context?.auxiliary || settings?.routing?.zdr || c?.mode === 'off') headers['X-OpenRouter-Cache'] = 'false';
  else if (c?.mode === 'on') {
    headers['X-OpenRouter-Cache'] = 'true';
    headers['X-OpenRouter-Cache-TTL'] = String(c.ttlSeconds ?? 300);
    if (context?.regenerate) headers['X-OpenRouter-Cache-Clear'] = 'true';
  }
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
