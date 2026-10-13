import type { ConfigInterface, MessageInterface, TextContentInterface } from '@type/chat';

export const normalizeAssistantPrefill = (value?: string): string | undefined => value?.trim() || undefined;

/** Wllama's existing chat-template boundary accepts ordered role/string pairs. */
export function buildLocalChatMessages(contextMessages: MessageInterface[]): { role: string; content: string }[] {
  return contextMessages.map((message) => ({
    role: message.role,
    content: message.content.filter((part): part is TextContentInterface => part.type === 'text')
      .map(part => part.text).join('\n'),
  }));
}
export function createLocalGenerationInput(messages: {role:string;content:string}[], config: ConfigInterface, assistantPrefill?: string) {
  return { messages, config, assistantPrefix: assistantPrefill || undefined };
}
