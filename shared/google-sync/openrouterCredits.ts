import { OPENROUTER_CREDITS_ENDPOINT, displayOpenRouterCredits, parseOpenRouterCredits, shouldFetchOpenRouterCredits } from '../../src/utils/openrouterCredits';

export function openRouterCredits(json: string): string {
  const input = JSON.parse(json);
  switch (input.operation) {
    case 'policy': return JSON.stringify({ fetch: shouldFetchOpenRouterCredits(input) });
    case 'display': return JSON.stringify({ display: displayOpenRouterCredits(input.balance) });
    case 'request': return JSON.stringify({ endpoint: OPENROUTER_CREDITS_ENDPOINT,
      authentication: { header: 'Authorization', scheme: 'Bearer' } });
    case 'parse': {
      const balance = parseOpenRouterCredits(input.payload);
      return JSON.stringify(balance && { balance });
    }
    default: throw new Error('Unknown OpenRouter credits operation.');
  }
}
