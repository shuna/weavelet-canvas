import { isAzureEndpoint } from '@utils/api';
import type { ConfigInterface } from '@type/chat';

export type RequestTransport = { endpoint: string; headers: Record<string, string>; authentication: { name: string; prefix: string }[] };
/** URL/header rules shared by all actual Web completion entry points. Secrets are bound by the host. */
export function prepareRequestTransport(endpoint: string, config: ConfigInterface, hasApiKey: boolean,
  customHeaders?: Record<string, string>, apiVersionToUse?: string): RequestTransport {
  const headers = { 'Content-Type': 'application/json', ...customHeaders };
  const authentication = hasApiKey ? [{ name: 'Authorization', prefix: 'Bearer ' }] : [];
  if (isAzureEndpoint(endpoint) && hasApiKey) {
    authentication.push({ name: 'api-key', prefix: '' });
    const apiVersion = apiVersionToUse ?? '2024-02-01';
    const path = `openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;
    if (!endpoint.endsWith(path)) {
      if (!endpoint.endsWith('/')) endpoint += '/';
      endpoint += path;
    }
  }
  return { endpoint: endpoint.trim(), headers, authentication };
}
export function bindRequestAuthentication(transport: RequestTransport, apiKey?: string): Record<string, string> {
  const headers = { ...transport.headers };
  for (const descriptor of transport.authentication) headers[descriptor.name] = descriptor.prefix + apiKey;
  return headers;
}
