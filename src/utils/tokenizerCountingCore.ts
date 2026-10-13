import { isTextContent, type MessageInterface } from '@type/chat';
import { estimateTokensByChars } from './chatTitle';

export const ensureNonZeroTokenCount = (count: number, messages: MessageInterface[]): number => {
  const hasText = messages.some(message => message.content.some(part => isTextContent(part) && part.text.trim().length > 0));
  return count > 0 || !hasText ? count : estimateTokensByChars(messages);
};

export const fallbackLimitMessageIndices = (messages: MessageInterface[], limit: number): number[] => {
  const indices: number[] = [];
  let tokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const estimate = estimateTokensByChars([messages[i]]);
    if (estimate + tokens > limit) break;
    tokens += estimate;
    indices.unshift(i);
  }
  return indices;
};
