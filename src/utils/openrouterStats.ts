import type { OpenRouterGenerationStats } from '@api/openrouter';
import type { PendingOpenRouterVerification, VerifiedStats } from '@store/openrouter-stats-slice';
import { OPENROUTER_VERIFICATION_INITIAL_DELAY_MS, buildVerifiedStatsKey } from './openrouterVerification';

export type StatsState = {
  verifiedStats: Record<string, VerifiedStats>;
  pendingVerifications: Record<string, PendingOpenRouterVerification>;
};
export type StatsAction = {
  type: 'queue' | 'fetching' | 'failed' | 'retry' | 'verified' | 'remove' | 'clear';
  key?: string;
  verification?: Partial<PendingOpenRouterVerification> & Pick<PendingOpenRouterVerification, 'generationId' | 'chatId' | 'targetNodeId'>;
  stats?: VerifiedStats;
  error?: string;
  nextAttemptAt?: number;
};

export { buildVerifiedStatsKey };
export const generationStatsRequest = (generationId: string) => ({
  endpoint: `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
  authentication: { header: 'Authorization', scheme: 'Bearer' },
});

export const toVerifiedStats = (raw: OpenRouterGenerationStats, now = Date.now()): VerifiedStats => ({
  generationId: raw.id, model: raw.model, promptTokens: raw.tokens_prompt,
  completionTokens: raw.tokens_completion, nativePromptTokens: raw.native_tokens_prompt,
  nativeCompletionTokens: raw.native_tokens_completion, totalCost: raw.total_cost,
  cacheDiscount: raw.cache_discount, error: raw.error, fetchedAt: now,
});

export const parseVerifiedStats = (payload: unknown, generationId: string, now: number): VerifiedStats | null => {
  if (!payload || typeof payload !== 'object' || !Number.isFinite(now)) return null;
  const raw = (payload as { data?: unknown }).data;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.id !== generationId || typeof value.model !== 'string' || !value.model ||
      (value.error !== undefined && typeof value.error !== 'string') ||
      (value.cache_discount !== null && (typeof value.cache_discount !== 'number' || !Number.isFinite(value.cache_discount))) ||
      ['tokens_prompt','tokens_completion','native_tokens_prompt','native_tokens_completion','total_cost']
        .some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) return null;
  return toVerifiedStats(raw as OpenRouterGenerationStats, now);
};

export const transitionOpenRouterStats = (state: StatsState, action: StatsAction, now: number): StatsState => {
  const key = action.key ?? '';
  const existing = state.pendingVerifications[key];
  switch (action.type) {
    case 'queue': {
      if (!action.verification) return state;
      const verification = action.verification;
      return { ...state, pendingVerifications: { ...state.pendingVerifications, [key]: {
        ...existing, generationId: verification.generationId, chatId: verification.chatId,
        targetNodeId: verification.targetNodeId,
        requestedAt: verification.requestedAt ?? existing?.requestedAt ?? now,
        nextAttemptAt: verification.nextAttemptAt ?? now + OPENROUTER_VERIFICATION_INITIAL_DELAY_MS,
        attemptCount: existing?.attemptCount ?? 0, status: 'pending',
        lastAttemptAt: existing?.lastAttemptAt, lastError: undefined,
      } } };
    }
    case 'fetching':
      return existing ? { ...state, pendingVerifications: { ...state.pendingVerifications,
        [key]: { ...existing, status: 'fetching', attemptCount: existing.attemptCount + 1,
          lastAttemptAt: now, lastError: undefined } } } : state;
    case 'failed':
      return existing ? { ...state, pendingVerifications: { ...state.pendingVerifications,
        [key]: { ...existing, status: 'failed', nextAttemptAt: action.nextAttemptAt ?? Number.MAX_SAFE_INTEGER,
          lastError: action.error ?? '' } } } : state;
    case 'retry':
      return existing ? { ...state, pendingVerifications: { ...state.pendingVerifications,
        [key]: { ...existing, status: 'pending', nextAttemptAt: now, lastError: undefined } } } : state;
    case 'verified': {
      if (!action.stats) return state;
      const verifiedStats = { ...state.verifiedStats, [key]: action.stats };
      const pendingVerifications = { ...state.pendingVerifications };
      delete pendingVerifications[key];
      const keys = Object.keys(verifiedStats);
      if (keys.length > 50) {
        keys.sort((a, b) => (verifiedStats[a]?.fetchedAt ?? 0) - (verifiedStats[b]?.fetchedAt ?? 0));
        for (let i = 0; i < keys.length - 50; i++) delete verifiedStats[keys[i]];
      }
      return { ...state, verifiedStats, pendingVerifications };
    }
    case 'remove': {
      if (!existing) return state;
      const pendingVerifications = { ...state.pendingVerifications };
      delete pendingVerifications[key];
      return { ...state, pendingVerifications };
    }
    case 'clear': return { ...state, verifiedStats: {}, pendingVerifications: {} };
  }
};

export const scheduleOpenRouterStats = (state: StatsState, now: number) => {
  const entries = Object.entries(state.pendingVerifications);
  const dueKeys = entries.filter(([, item]) => item.status !== 'fetching' && item.nextAttemptAt <= now).map(([key]) => key);
  const future = entries.filter(([, item]) => item.status !== 'fetching' && Number.isFinite(item.nextAttemptAt) &&
    item.nextAttemptAt > now && item.nextAttemptAt < Number.MAX_SAFE_INTEGER).map(([, item]) => item.nextAttemptAt);
  return { dueKeys, nextAt: future.length ? Math.min(...future) : null };
};

export const recoverOpenRouterStats = (state: StatsState, now: number): StatsState => ({
  ...state,
  verifiedStats: state.verifiedStats && typeof state.verifiedStats === 'object' ? state.verifiedStats : {},
  pendingVerifications: state.pendingVerifications && typeof state.pendingVerifications === 'object'
    ? Object.fromEntries(Object.entries(state.pendingVerifications).flatMap(([key, verification]) => {
      if (!verification || typeof verification !== 'object') return [];
      const normalized = {
        ...verification,
        status: ['fetching','pending','failed'].includes(verification.status) ? verification.status : 'pending',
        nextAttemptAt: typeof verification.nextAttemptAt === 'number' ? verification.nextAttemptAt : now,
      };
      return [[key, normalized.status === 'fetching'
        ? { ...normalized, status:'pending', nextAttemptAt:Math.min(normalized.nextAttemptAt,now) }
        : normalized]];
    })) : {},
});
