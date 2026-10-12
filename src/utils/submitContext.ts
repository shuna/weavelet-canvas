import {
  type ContentInterface,
  type MessageInterface,
  type TextContentInterface,
  isImageContent,
  isTextContent,
  isToolCallContent,
  isToolResultContent,
} from '@type/chat';

/** Check if model supports system role (reasoning models don't) */
export const modelSupportsSystemRole = (modelId: string): boolean => {
  return !isReasoningModel(modelId);
};

const isReasoningModel = (modelId: string): boolean =>
  modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o1 ');

const sanitizeMessageContent = (
  content: ContentInterface[]
): ContentInterface[] =>
  content.filter((part) => {
    if (part.type === 'reasoning') return false;
    if (isImageContent(part)) return true;
    if (isToolCallContent(part) || isToolResultContent(part)) return true;
    return isTextContent(part) && part.text.trim().length > 0;
  });

const hasToolContent = (message: MessageInterface): boolean =>
  message.content.some((c) => isToolCallContent(c) || isToolResultContent(c));

const ensureRoleAlternation = (
  messages: MessageInterface[]
): MessageInterface[] => {
  const result: MessageInterface[] = [];
  for (const msg of messages) {
    if (
      result.length > 0 &&
      result[result.length - 1].role === msg.role &&
      !hasToolContent(result[result.length - 1]) &&
      !hasToolContent(msg)
    ) {
      // Merge consecutive same-role messages
      const prev = result[result.length - 1];
      result[result.length - 1] = {
        ...prev,
        content: [...prev.content, ...msg.content],
      };
    } else {
      result.push(msg);
    }
  }
  return result;
};

export const filterOmittedMessages = (
  messages: MessageInterface[],
  activePath: string[] | undefined,
  omittedNodes: Record<string, boolean>
): MessageInterface[] => {
  if (Object.keys(omittedNodes).length === 0) return messages;

  return messages.filter((_, idx) => {
    const nodeId = activePath?.[idx] ?? String(idx);
    if (!omittedNodes[nodeId]) return true;
    // Never omit messages containing tool_call/tool_result
    if (hasToolContent(messages[idx])) return true;
    return false;
  });
};

export const sanitizeMessagesForSubmit = (
  messages: MessageInterface[]
): MessageInterface[] =>
  ensureRoleAlternation(
    messages
      .map((message) => ({
        ...message,
        content: sanitizeMessageContent(message.content),
      }))
      .filter((message) => message.content.length > 0)
  );

export const getSubmitContextMessages = (
  messages: MessageInterface[],
  messageIndex: number,
  modelId?: string,
  activePath?: string[],
  omittedNodes: Record<string, boolean> = {},
  systemPrompt?: string
): MessageInterface[] => {
  const sliced = messages.slice(0, messageIndex);
  const filtered = filterOmittedMessages(sliced, activePath, omittedNodes);

  // Strip ALL system-role messages from the message array (config is the source of truth)
  const withoutSystem = filtered.filter((m) => m.role !== 'system');

  // Sanitize (clean content, merge consecutive same-role, etc.)
  const sanitized = sanitizeMessagesForSubmit(withoutSystem);

  // Prepend config system prompt if non-empty and model supports it
  const supportsSystem = modelId ? modelSupportsSystemRole(modelId) : true;
  if (systemPrompt && supportsSystem) {
    return [
      { role: 'system', content: [{ type: 'text', text: systemPrompt } as TextContentInterface] },
      ...sanitized,
    ];
  }
  return sanitized;
};

