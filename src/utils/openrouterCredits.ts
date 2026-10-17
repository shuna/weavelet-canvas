export const OPENROUTER_CREDITS_ENDPOINT = 'https://openrouter.ai/api/v1/credits';

type CreditAmounts = { totalCredits: number; totalUsage: number };
type CreditPolicy = {
  reason: 'open' | 'completed' | 'manual';
  now: number;
  lastFetch: number;
  inFlight: boolean;
  fetchedAt?: number;
};

export const shouldFetchOpenRouterCredits = ({ reason, now, lastFetch, inFlight, fetchedAt }: CreditPolicy): boolean =>
  !inFlight && now - lastFetch >= 3_000 &&
  (reason !== 'open' || fetchedAt === undefined || now - fetchedAt > 5 * 60 * 1_000);

export const displayOpenRouterCredits = ({ totalCredits, totalUsage }: CreditAmounts): string | null =>
  Number.isFinite(totalCredits) && Number.isFinite(totalUsage)
    ? `$${Math.max(0, totalCredits - totalUsage).toFixed(2)}` : null;

export const parseOpenRouterCredits = (payload: unknown): CreditAmounts | null => {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const { total_credits, total_usage } = data as Record<string, unknown>;
  return typeof total_credits === 'number' && Number.isFinite(total_credits) &&
    typeof total_usage === 'number' && Number.isFinite(total_usage)
    ? { totalCredits: total_credits, totalUsage: total_usage }
    : null;
};
