type EndpointURL = { protocol: string; hostname: string; port?: string };

export type OpenRouterCancelInput = {
  providerID: string;
  endpointURL: EndpointURL;
  generationID?: string;
};

export const isOpenRouterCancelEligible = ({ providerID, endpointURL }: Omit<OpenRouterCancelInput, 'generationID'>): boolean =>
  providerID === 'openrouter' && endpointURL?.protocol === 'https:' && endpointURL.hostname === 'openrouter.ai' &&
  (!endpointURL.port || endpointURL.port === '443');

export const openRouterCancelTarget = (input: OpenRouterCancelInput): { endpoint: string } | null =>
  isOpenRouterCancelEligible(input) && typeof input.generationID === 'string' && input.generationID.startsWith('gen-')
    ? { endpoint: `https://openrouter.ai/api/v1/generation/${encodeURIComponent(input.generationID)}/cancel` }
    : null;
