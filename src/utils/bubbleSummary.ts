import type { BubbleSummary, ChatInterface, MessageInterface } from '@type/chat';
import { isTextContent, isToolCallContent, isToolResultContent } from '@type/chat';

// Decode only complete JSON output; ordinary Markdown and literal code escapes stay intact.
export const normalizeBubbleSummaryText = (text: string): string => {
  const trimmed = text.trim();
  const json = trimmed.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === 'string') return value.trim();
    const messages = Array.isArray(value) ? value : [value];
    if (messages.length && messages.every(message => message && typeof message === 'object'
      && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')) {
      return messages.map(message => message.role === 'assistant' ? `アシスタント：\n${message.content}` : message.content).join('\n\n').trim();
    }
  } catch { /* Not serialized output: preserve the original text. */ }
  return trimmed;
};

const textParts = (message: MessageInterface | undefined): string[] | null => {
  if (!message?.content?.length || !message.content.every(isTextContent)) return null;
  const parts = message.content.map(value => value.text);
  return parts.some(part => part.trim()) ? parts : null;
};
const hasTool = (message: MessageInterface | undefined) => !!message?.content?.some(value => isToolCallContent(value) || isToolResultContent(value));
const equalParts = (left: string[], right: string[]) => left.length === right.length && left.every((part, index) => part === right[index]);

const validGeneration = (value: unknown) => {
  if (value === undefined) return true;
  const generation = value as NonNullable<BubbleSummary['generation']>;
  return !!generation && typeof generation === 'object' && typeof generation.model === 'string'
    && (generation.providerId === undefined || typeof generation.providerId === 'string')
    && Number.isFinite(generation.createdAt) && !!generation.settings && typeof generation.settings === 'object'
    && Number.isFinite(generation.settings.temperature) && Number.isFinite(generation.settings.max_tokens)
    && (generation.settings.reasoning_effort === undefined || typeof generation.settings.reasoning_effort === 'string');
};

export const isBubbleSummary = (value: unknown): value is BubbleSummary => !!value && typeof value === 'object'
  && typeof (value as BubbleSummary).id === 'string'
  && ((value as BubbleSummary).mode === 'single' || (value as BubbleSummary).mode === 'through' || (value as BubbleSummary).mode === 'range')
  && typeof (value as BubbleSummary).text === 'string'
  && typeof (value as BubbleSummary).useForSubmit === 'boolean'
  && ((value as BubbleSummary).format === undefined || (value as BubbleSummary).format === 'compact')
  && validGeneration((value as BubbleSummary).generation)
  && Array.isArray((value as BubbleSummary).sources)
  && (value as BubbleSummary).sources.every(source => !!source && typeof source.nodeId === 'string' && (source.parentId === null || typeof source.parentId === 'string') && (source.role === 'user' || source.role === 'assistant') && Array.isArray(source.textParts) && source.textParts.every(part => typeof part === 'string'));

export const isSummaryEligible = (message: MessageInterface | undefined) =>
  !!message && (message.role === 'user' || message.role === 'assistant') && textParts(message) !== null && !hasTool(message);

export const resolveValidSummary = (chat: ChatInterface, summary: BubbleSummary | unknown, generatingNodeIds: string[] = []) => {
  if (!isBubbleSummary(summary)) return null;
  const candidate = summary as BubbleSummary, path = chat.branchTree?.activePath ?? chat.messages.map((_, index) => String(index));
  if (typeof candidate.text !== 'string' || !candidate.text.trim() || !Array.isArray(candidate.sources) || !candidate.sources.length) return null;
  const indices = candidate.sources.map(source => path.indexOf(source?.nodeId));
  if (indices.some(index => index < 0) || new Set(indices).size !== indices.length) return null;
  const first = Math.min(...indices), last = Math.max(...indices);
  if (last - first + 1 !== indices.length) return null;
  for (let offset = 0; offset < candidate.sources.length; offset++) {
    const index = first + offset, source = candidate.sources[offset], nodeId = path[index];
    const node = chat.branchTree?.nodes[nodeId], message = chat.messages[index], parts = textParts(message);
    if (!source || source.nodeId !== nodeId || generatingNodeIds.includes(nodeId)
      || !isSummaryEligible(message) || !parts || message.role !== source.role || !Array.isArray(source.textParts) || !equalParts(parts, source.textParts)
      || (node?.parentId ?? null) !== source.parentId) return null;
  }
  return { first, last };
};

export const getAppliedBubbleSummaries = (chat: ChatInterface, messageIndex = chat.messages.length, generatingNodeIds: string[] = []) => {
  const candidates = (Array.isArray(chat.summaries) ? chat.summaries : []).filter(summary => summary?.useForSubmit)
    .map(summary => ({ summary, range: resolveValidSummary(chat, summary, generatingNodeIds) }))
    .filter((value): value is { summary: BubbleSummary; range: { first: number; last: number } } => !!value.range && value.range.last < messageIndex);
  const accepted = candidates.filter(candidate => !candidates.some(other => other !== candidate && candidate.range.first <= other.range.last && other.range.first <= candidate.range.last));
  return accepted;
};

export const bubbleSummarySubmitMessage = (summary: BubbleSummary): MessageInterface => ({ role: 'user', content: [{ type: 'text', text: `${summary.format === 'compact' ? 'Retained conversation context. Answer the latest request using the requirements and state below. Follow the retained language, tone, structure and length requirements and examples, not formatting added for this summary. Adoption and plans do not imply execution; preserve uncertainty about what has been done.\n' : 'Past conversation summary:\n'}${normalizeBubbleSummaryText(summary.text)}` }] });

export const applyBubbleSummariesForSubmit = (chat: ChatInterface, messageIndex: number, generatingNodeIds: string[] = []): MessageInterface[] => {
  const source = chat.messages.slice(0, messageIndex), path = chat.branchTree?.activePath ?? source.map((_, index) => String(index));
  const accepted = getAppliedBubbleSummaries(chat, messageIndex, generatingNodeIds)
    .filter(({ summary }) => !summary.sources.some(source => chat.omittedNodes?.[source.nodeId]));
  const starts = new Map(accepted.map(value => [value.range.first, value]));
  const result: MessageInterface[] = [];
  for (let index = 0; index < source.length; index++) {
    const replacement = starts.get(index);
    if (replacement) { result.push(bubbleSummarySubmitMessage(replacement.summary)); index = replacement.range.last; continue; }
    if (chat.omittedNodes?.[path[index]] && !hasTool(source[index])) continue;
    result.push(source[index]);
  }
  return result;
};
