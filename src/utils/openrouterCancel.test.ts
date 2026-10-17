import { describe, expect, it } from 'vitest';
import { isOpenRouterCancelEligible, openRouterCancelTarget } from './openrouterCancel';
import { openRouterCancel } from '../../shared/google-sync/remoteOutput';

const canonical = { providerID: 'openrouter', endpointURL: { protocol: 'https:', hostname: 'openrouter.ai' } };

describe('OpenRouter provider cancel target', () => {
  it('allows canonical HTTPS OpenRouter before an ID arrives, then returns an endpoint without a key', () => {
    expect(isOpenRouterCancelEligible(canonical)).toBe(true);
    const input = { ...canonical, generationID: 'gen-one' };
    expect(openRouterCancelTarget(input)).toEqual({ endpoint: 'https://openrouter.ai/api/v1/generation/gen-one/cancel' });
    expect(JSON.parse(openRouterCancel(JSON.stringify(input)))).toEqual({
      endpoint: 'https://openrouter.ai/api/v1/generation/gen-one/cancel',
      authentication: { header: 'Authorization', scheme: 'Bearer' },
    });
  });

  it('rejects alternate origins, providers, and non-generation IDs', () => {
    for (const input of [
      { ...canonical, providerID: 'custom', generationID: 'gen-one' },
      { ...canonical, endpointURL: { protocol: 'http:', hostname: 'openrouter.ai' }, generationID: 'gen-one' },
      { ...canonical, endpointURL: { protocol: 'https:', hostname: 'eu.openrouter.ai' }, generationID: 'gen-one' },
      { ...canonical, endpointURL: { protocol: 'https:', hostname: 'us.openrouter.ai' }, generationID: 'gen-one' },
      { ...canonical, endpointURL: { protocol: 'https:', hostname: 'fixture.invalid' }, generationID: 'gen-one' },
      { ...canonical, endpointURL: { protocol: 'https:', hostname: 'openrouter.ai', port: '8443' }, generationID: 'gen-one' },
      { ...canonical, generationID: 'other-id' },
    ]) {
      expect(openRouterCancelTarget(input)).toBeNull();
      expect(JSON.parse(openRouterCancel(JSON.stringify(input)))).toBeNull();
    }
  });
});
