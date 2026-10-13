import type { GenerateOptions } from '../local-llm/types';

export const localGenerationOptions = (options: GenerateOptions) => ({
  maxTokens: options.maxTokens ?? 256, temperature: options.temperature ?? 0.7, stop: options.stop,
});
export const appendAssistantPrefix = (prompt: string, prefix?: string): string => prefix ? prompt + prefix : prompt;
export const localFallbackPrompt = (messages: {role:string;content:string}[], prefix?: string): string =>
  appendAssistantPrefix(messages.map(message => `${message.role}: ${message.content}`).join('\n\n') + '\n\nassistant:', prefix);

/** Matches the actual worker: stop-list order takes precedence over match position. */
export function trimLocalStopStrings(fullText: string, stopStrings: string[] = []) {
  for (const stop of stopStrings) {
    const index = fullText.indexOf(stop);
    if (index !== -1) return {text:fullText.slice(0,index),stopped:true};
  }
  return {text:fullText,stopped:false};
}
export function prepareLocalGenerationOutput(fullText:string,prefix='',stopStrings:string[]=[]){
  const output=trimLocalStopStrings(fullText,stopStrings);
  const text=prefix+output.text;
  return {parts:text?[{type:'text' as const,text}]:[],text,reasoning:'',isEmpty:!text,stopped:output.stopped};
}
