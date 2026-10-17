export const PROXY_RECOVERY_MAX_RETRIES = 3;
export const PROXY_RECOVERY_RETRY_DELAY_MS = 500;

export type ProxyRecoveryOutcome = 'complete' | 'partial' | 'network' | 'abort';

export function proxyRecoveryRetry(input: { attempt: number; outcome: ProxyRecoveryOutcome; retry?: boolean;
                                            retryAfter?: string | null; retryAfterMs?: number }): { retry: boolean; delayMs: number } {
  const seconds = input.retryAfter === null || input.retryAfter === undefined ? NaN : Number(input.retryAfter);
  const headerDelay = Number.isFinite(seconds) ? Math.min(Math.max(seconds * 1000, 0), 5_000) : undefined;
  const delay = input.retryAfterMs ?? headerDelay;
  return {
    retry: input.attempt < PROXY_RECOVERY_MAX_RETRIES &&
      (input.outcome === 'network' || (input.outcome === 'partial' && input.retry === true)),
    delayMs: delay !== undefined && Number.isFinite(delay) ? Math.min(Math.max(delay, 0), 5_000) : PROXY_RECOVERY_RETRY_DELAY_MS,
  };
}
