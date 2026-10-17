import { useEffect, useRef } from 'react';

import { fetchCreditBalance, fetchGenerationStats } from '@api/openrouter';
import useStore, { type StoreState } from '@store/store';
import { debugReport } from '@store/debug-store';
import { resolveOpenRouterApiKey } from '@utils/openrouterVerification';
import { scheduleOpenRouterStats } from '@utils/openrouterStats';

const EMPTY_PENDING_VERIFICATIONS: StoreState['pendingVerifications'] = {};
const NO_AUTO_RETRY_AT = Number.MAX_SAFE_INTEGER;

const formatDebugTime = (time = Date.now()): string =>
  new Date(time).toISOString().slice(11, 23);

export default function useOpenRouterVerification() {
  const pendingVerifications = useStore((state) =>
    state.pendingVerifications && typeof state.pendingVerifications === 'object'
      ? state.pendingVerifications
      : EMPTY_PENDING_VERIFICATIONS
  );
  const providers = useStore((state) => state.providers);
  const apiEndpoint = useStore((state) => state.apiEndpoint);
  const apiKey = useStore((state) => state.apiKey);
  const inFlightRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActiveTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (Object.keys(pendingVerifications).length === 0) {
      clearActiveTimer();
      return;
    }

    const now = Date.now();
    const { dueKeys, nextAt } = scheduleOpenRouterStats({ verifiedStats: {}, pendingVerifications },now);

    if (dueKeys.length > 0) {
      for (const statsKey of dueKeys) {
        const verification = pendingVerifications[statsKey];
        if (inFlightRef.current.has(statsKey)) continue;

        const resolvedApiKey = resolveOpenRouterApiKey(
          providers.openrouter,
          apiEndpoint,
          apiKey
        );

        if (!resolvedApiKey) {
          useStore
            .getState()
            .markVerificationFailed(
              statsKey,
              'OpenRouter API key is not configured',
              NO_AUTO_RETRY_AT
            );
          continue;
        }

        inFlightRef.current.add(statsKey);
        useStore.getState().markVerificationFetching(statsKey);
        debugReport(`or-verify:${statsKey}`, {
          label: 'OpenRouter Verify',
          status: 'active',
          detail: `${formatDebugTime()} fetch ${verification.generationId}`,
        });

        void fetchGenerationStats(verification.generationId, resolvedApiKey)
          .then((stats) => {
            if (stats) {
              useStore.getState().setVerifiedStats(statsKey, stats);
              debugReport(`or-verify:${statsKey}`, {
                status: 'done',
                detail: `${formatDebugTime()} fetched ${stats.generationId}`,
              });
              // Refresh credit balance alongside verified stats
              void fetchCreditBalance(resolvedApiKey).then((info) => {
                if (info) {
                  useStore.getState().setCreditBalance({
                    totalCredits: info.total_credits,
                    totalUsage: info.total_usage,
                    fetchedAt: Date.now(),
                  });
                }
              });
              return;
            }
            useStore
              .getState()
              .markVerificationFailed(
                statsKey,
                'OpenRouter generation stats unavailable',
                NO_AUTO_RETRY_AT
              );
            debugReport(`or-verify:${statsKey}`, {
              status: 'error',
              detail: `${formatDebugTime()} unavailable ${verification.generationId}`,
            });
          })
          .catch((error: unknown) => {
            useStore
              .getState()
              .markVerificationFailed(
                statsKey,
                error instanceof Error
                  ? error.message
                  : 'Failed to fetch OpenRouter generation stats',
                NO_AUTO_RETRY_AT
              );
            debugReport(`or-verify:${statsKey}`, {
              status: 'error',
              detail: `${formatDebugTime()} failed ${verification.generationId}`,
            });
          })
          .finally(() => {
            inFlightRef.current.delete(statsKey);
          });
      }
    }

    if (nextAt === null) {
      clearActiveTimer();
      return;
    }

    clearActiveTimer();
    timerRef.current = setTimeout(() => {
      useStore.setState((state) => ({ pendingVerifications: { ...state.pendingVerifications } }));
    }, Math.max(0, nextAt - now));

    return () => {
      clearActiveTimer();
    };
  }, [pendingVerifications, providers, apiEndpoint, apiKey]);
}
