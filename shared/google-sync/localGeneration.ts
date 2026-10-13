import { prepareLocalGenerationOutput, localFallbackPrompt, localGenerationOptions } from '../../src/utils/localGenerationOutput';
import { getGenerationMessages, type GenerationContextInput } from './generation';
import { buildLocalChatMessages, createLocalGenerationInput, normalizeAssistantPrefill } from '../../src/utils/localGenerationInput';

export function localGenerationInput(json: string): string {
  const input = JSON.parse(json) as GenerationContextInput & { assistantPrefill?: string };
  const messages = buildLocalChatMessages(getGenerationMessages(input));
  const prepared=createLocalGenerationInput(messages,input.config,normalizeAssistantPrefill(input.assistantPrefill));
  return JSON.stringify({...prepared,fallbackPrompt:localFallbackPrompt(prepared.messages,prepared.assistantPrefix),
    options:localGenerationOptions({maxTokens:input.config.max_tokens,temperature:input.config.temperature})});
}

export function localGenerationOutput(json:string):string {
  const input=JSON.parse(json) as {fullText:string;prefix?:string;stop?:string[]};
  return JSON.stringify(prepareLocalGenerationOutput(input.fullText,input.prefix,input.stop));
}
