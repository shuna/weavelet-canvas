import { DEFAULT_PROVIDERS } from '@store/provider-config';
import type { ProviderConfig } from '@type/provider';

export const OPENROUTER_VERIFICATION_INITIAL_DELAY_MS = 10000;
export const OPENROUTER_VERIFICATION_MAX_DELAY_MS = 120000;

export const buildVerifiedStatsKey = (chatId: string, targetNodeId: string): string =>
  `${chatId}:::${targetNodeId}`;

export const getOpenRouterVerificationRetryDelay = (attemptCount: number): number =>
  Math.min(
    OPENROUTER_VERIFICATION_INITIAL_DELAY_MS * Math.max(1, 2 ** Math.max(0, attemptCount - 1)),
    OPENROUTER_VERIFICATION_MAX_DELAY_MS
  );

export const resolveOpenRouterApiKey = (
  provider: ProviderConfig | undefined,
  fallbackEndpoint?: string,
  fallbackApiKey?: string
): string | undefined => {
  const sameOrigin = (endpoint?: string): boolean => {
    try {
      const url = new URL(endpoint ?? '');
      return url.origin === new URL(DEFAULT_PROVIDERS.openrouter.endpoint).origin &&
        !url.username && !url.password;
    } catch {
      return false;
    }
  };
  // Credits and verification always use the canonical API, never a custom provider origin.
  if (provider?.apiKey && sameOrigin(provider.endpoint)) return provider.apiKey;

  if (fallbackApiKey && sameOrigin(fallbackEndpoint)) {
    return fallbackApiKey;
  }

  return undefined;
};
