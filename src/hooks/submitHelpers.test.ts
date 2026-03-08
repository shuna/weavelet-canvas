import { describe, expect, it } from 'vitest';

import { _defaultChatConfig } from '@constants/chat';
import type { MessageInterface } from '@type/chat';
import type { FavoriteModel } from '@type/provider';
import {
  buildGeneratingSession,
  buildTitlePromptMessage,
  getSubmitContextMessages,
  resolveProviderForModel,
} from './submitHelpers';

const textMessage = (role: MessageInterface['role'], text: string): MessageInterface => ({
  role,
  content: [{ type: 'text', text }],
});

describe('submitHelpers', () => {
  it('builds a generating session with expected metadata', () => {
    const session = buildGeneratingSession(
      'session-1',
      'chat-1',
      2,
      3,
      'midchat',
      3
    );

    expect(session).toMatchObject({
      sessionId: 'session-1',
      chatId: 'chat-1',
      chatIndex: 2,
      messageIndex: 3,
      mode: 'midchat',
      insertIndex: 3,
      requestPath: 'sw',
    });
    expect(session.startedAt).toEqual(expect.any(Number));
  });

  it('resolves provider config from favorite model selection', () => {
    const favoriteModels: FavoriteModel[] = [
      { modelId: 'gpt-4o', providerId: 'openai' },
    ];

    const resolved = resolveProviderForModel(
      'gpt-4o',
      favoriteModels,
      {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          modelsRequireAuth: true,
          apiKey: 'secret',
        },
      },
      { endpoint: 'fallback', key: 'fallback-key' }
    );

    expect(resolved).toEqual({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      key: 'secret',
    });
  });

  it('builds title prompt message and submit context slices', () => {
    const userMessage = textMessage('user', 'Question');
    const assistantMessage = textMessage('assistant', 'Answer');
    const titlePrompt = buildTitlePromptMessage(
      userMessage.content,
      assistantMessage.content,
      'ja'
    );

    expect(titlePrompt.role).toBe('user');
    expect(titlePrompt.content.at(-1)).toEqual({
      type: 'text',
      text: 'Generate a title in less than 6 words for the conversation so far (language: ja)',
    });

    const contextMessages = getSubmitContextMessages(
      [userMessage, assistantMessage, textMessage('assistant', '')],
      'append',
      2
    );
    expect(contextMessages).toEqual([userMessage, assistantMessage]);
  });
});
