import type { StoreSlice } from './store';
import type { OpenRouterGenerationStats } from '@api/openrouter';
import { transitionOpenRouterStats, toVerifiedStats as convertVerifiedStats, type StatsAction } from '@utils/openrouterStats';

export interface VerifiedStats {
  generationId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  nativePromptTokens: number;
  nativeCompletionTokens: number;
  totalCost: number;
  cacheDiscount: number | null;
  error?: string;
  fetchedAt: number;
}

export interface PendingOpenRouterVerification {
  generationId: string;
  chatId: string;
  targetNodeId: string;
  requestedAt: number;
  nextAttemptAt: number;
  attemptCount: number;
  status: 'pending' | 'fetching' | 'failed';
  lastAttemptAt?: number;
  lastError?: string;
}

export interface CreditBalance {
  totalCredits: number;
  totalUsage: number;
  fetchedAt: number;
}

export interface OpenRouterStatsSlice {
  /**
   * Verified generation stats keyed by `chatId:::targetNodeId`.
   * Only the most recent N entries are kept to avoid unbounded growth.
   */
  verifiedStats: Record<string, VerifiedStats>;
  pendingVerifications: Record<string, PendingOpenRouterVerification>;
  /** Ephemeral — not persisted to localStorage. */
  creditBalance: CreditBalance | null;
  creditBalanceFetching: boolean;
  setVerifiedStats: (key: string, stats: VerifiedStats) => void;
  queueVerification: (
    key: string,
    verification: Omit<
      PendingOpenRouterVerification,
      'requestedAt' | 'attemptCount' | 'status'
    > & { requestedAt?: number }
  ) => void;
  markVerificationFetching: (key: string) => void;
  markVerificationFailed: (
    key: string,
    error: string,
    nextAttemptAt: number
  ) => void;
  retryVerificationNow: (key: string) => void;
  removePendingVerification: (key: string) => void;
  clearVerifiedStats: () => void;
  setCreditBalance: (balance: CreditBalance | null) => void;
  setCreditBalanceFetching: (fetching: boolean) => void;
}

const changeStats = (prev: OpenRouterStatsSlice, action: StatsAction) => transitionOpenRouterStats({
  verifiedStats: prev.verifiedStats, pendingVerifications: prev.pendingVerifications,
},action,Date.now());

export const createOpenRouterStatsSlice: StoreSlice<OpenRouterStatsSlice> = (
  set
) => ({
  verifiedStats: {},
  pendingVerifications: {},
  creditBalance: null,
  creditBalanceFetching: false,
  setVerifiedStats: (key, stats) => set(prev => changeStats(prev,{type:'verified',key,stats})),
  queueVerification: (key, verification) => set(prev => changeStats(prev,{type:'queue',key,verification})),
  markVerificationFetching: key => set(prev => changeStats(prev,{type:'fetching',key})),
  markVerificationFailed: (key,error,nextAttemptAt) => set(prev => changeStats(prev,{type:'failed',key,error,nextAttemptAt})),
  retryVerificationNow: key => set(prev => changeStats(prev,{type:'retry',key})),
  removePendingVerification: key => set(prev => changeStats(prev,{type:'remove',key})),
  clearVerifiedStats: () => set(prev => changeStats(prev,{type:'clear'})),
  setCreditBalance: (balance) => set({ creditBalance: balance }),
  setCreditBalanceFetching: (fetching) => set({ creditBalanceFetching: fetching }),
});

export const toVerifiedStats = (raw: OpenRouterGenerationStats): VerifiedStats => convertVerifiedStats(raw);
