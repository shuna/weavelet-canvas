import { getGenerationMessages, type GenerationContextInput } from './generation';
import { buildLocalChatMessages, createLocalGenerationInput, normalizeAssistantPrefill } from '../../src/utils/localGenerationInput';

export function localGenerationInput(json: string): string {
  const input = JSON.parse(json) as GenerationContextInput & { assistantPrefill?: string };
  const messages = buildLocalChatMessages(getGenerationMessages(input));
  return JSON.stringify(createLocalGenerationInput(messages, input.config, normalizeAssistantPrefill(input.assistantPrefill)));
}
