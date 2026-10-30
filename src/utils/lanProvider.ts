import type { ProviderConfig } from '@type/provider';

/** Validates untrusted saved settings as well as form input before a request. */
export function validateLanProvider(provider: ProviderConfig): ProviderConfig {
  if (typeof provider.endpoint !== 'string' ||
      (provider.modelsEndpoint !== undefined && typeof provider.modelsEndpoint !== 'string') ||
      (provider.apiKey !== undefined && typeof provider.apiKey !== 'string') ||
      typeof provider.modelsRequireAuth !== 'boolean') throw new Error('Invalid LAN server settings');
  const endpoint = provider.endpoint.trim();
  const modelsEndpoint = provider.modelsEndpoint?.trim() || undefined;
  const apiKey = provider.modelsRequireAuth ? provider.apiKey?.trim() : undefined;
  const parse = (value: string) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Invalid LAN server URL'); }
    if (!/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.includes('#')) {
      throw new Error('Invalid LAN server URL');
    }
    return url;
  };
  if (endpoint) {
    const origin = parse(endpoint).origin;
    if (modelsEndpoint && parse(modelsEndpoint).origin !== origin) throw new Error('LAN server URLs must have the same origin');
  } else if (modelsEndpoint) {
    throw new Error('LAN generation URL is required');
  }
  if (provider.modelsRequireAuth && !apiKey) throw new Error('LAN API key is required');
  return { ...provider, endpoint, modelsEndpoint, apiKey };
}
