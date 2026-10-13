import type { EventSourceDataInterface, NonStreamingResponse } from '@type/api';
import { extractTextFromApiContent, extractReasoningFromApiContent, extractReasoningFromReasoningDetails } from './apiContent';
import { ThinkTagParser } from './thinkTagParser';

/**
 * Extract reasoning text from an SSE event delta.
 * Handles three formats:
 *  1. delta.reasoning (simple string — most providers via OpenRouter)
 *  2. delta.reasoning_content (DeepSeek-style)
 *  3. delta.reasoning_details (structured array with type: "reasoning.text")
 */
export const extractReasoningFromEvent = (event: EventSourceDataInterface): string => {
  const delta = event.choices?.[0]?.delta;
  if (!delta) return '';

  // Format 1: simple reasoning string
  if (delta.reasoning) return delta.reasoning;

  // Format 2: DeepSeek reasoning_content
  if (delta.reasoning_content) return delta.reasoning_content;

  // Format 3: reasoning_details array
  const detailsText = extractReasoningFromReasoningDetails(delta.reasoning_details);
  if (detailsText) return detailsText;

  // Format 4: content blocks that carry thinking/reasoning items
  const contentReasoning = extractReasoningFromApiContent(delta.content as never);
  if (contentReasoning) return contentReasoning;

  return '';
};

export const extractReasoningFromMessage = (
  message: NonStreamingResponse['choices'][number]['message']
): string => {
  if (message.reasoning) return message.reasoning;
  if (message.reasoning_content) return message.reasoning_content;
  const detailsText = extractReasoningFromReasoningDetails(message.reasoning_details);
  if (detailsText) return detailsText;
  const contentReasoning = extractReasoningFromApiContent(message.content as never);
  if (contentReasoning) return contentReasoning;
  return '';
};

/** Actual non-streaming completion conversion, including its text fallback. */
export function extractNonStreamingOutput(message: NonStreamingResponse['choices'][number]['message'], parser: ThinkTagParser) {
  const reasoningText = extractReasoningFromMessage(message);
  const rawMessageText = extractTextFromApiContent(message.content as never);
  const parsedContent = parser.process(rawMessageText);
  const flushedContent = parser.flush();
  return { content: (parsedContent.content + flushedContent.content) || rawMessageText,
    reasoning: reasoningText + parsedContent.reasoning + flushedContent.reasoning };
}
