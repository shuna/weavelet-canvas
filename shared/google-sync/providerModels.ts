import { normalizeModels } from '../../src/api/providerModels';
import type { ProviderId } from '../../src/types/provider';

export function providerModelList(json: string): string {
  const input = JSON.parse(json) as { providerId: ProviderId; data: unknown };
  return JSON.stringify({ models: normalizeModels(input.providerId, input.data) });
}
