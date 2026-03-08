import { describe, expect, it } from 'vitest';

import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';
import type { ExportV2, OpenAIChat } from '@type/export';
import {
  isOpenAIContent,
  validateAndFixChats,
  validateExportV2,
} from './import';

describe('import utilities', () => {
  it('normalizes legacy chat content strings into text content arrays', () => {
    const chats: unknown = [
      {
        title: 'Legacy Chat',
        messages: [{ role: 'user', content: 'hello' }],
        config: { ..._defaultChatConfig },
        imageDetail: _defaultImageDetail,
      },
    ];

    expect(validateAndFixChats(chats)).toBe(true);
    if (!validateAndFixChats(chats)) return;

    expect(chats[0].id).toEqual(expect.any(String));
    expect(chats[0].titleSet).toBe(false);
    expect(chats[0].messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('reassigns duplicate imported chat ids', () => {
    const chats: unknown = [
      {
        id: 'dup-chat',
        title: 'Chat A',
        messages: [{ role: 'user', content: 'hello' }],
        config: { ..._defaultChatConfig },
        imageDetail: _defaultImageDetail,
      },
      {
        id: 'dup-chat',
        title: 'Chat B',
        messages: [{ role: 'user', content: 'world' }],
        config: { ..._defaultChatConfig },
        imageDetail: _defaultImageDetail,
      },
    ];

    expect(validateAndFixChats(chats)).toBe(true);
    if (!validateAndFixChats(chats)) return;

    expect(chats[0].id).toBe('dup-chat');
    expect(chats[1].id).not.toBe('dup-chat');
    expect(chats[1].id).toEqual(expect.any(String));
  });

  it('accepts export v2 payloads with branch trees', () => {
    const exportData: ExportV2 = {
      version: 2,
      folders: {},
      chats: [
        {
          id: 'chat-1',
          title: 'Chat',
          titleSet: true,
          config: { ..._defaultChatConfig },
          imageDetail: _defaultImageDetail,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          branchTree: {
            rootId: 'node-1',
            activePath: ['node-1'],
            nodes: {
              'node-1': {
                id: 'node-1',
                parentId: null,
                role: 'user',
                contentHash: 'hash-1',
                createdAt: Date.now(),
              },
            },
          },
        },
      ],
    };

    expect(validateExportV2(exportData)).toBe(true);
  });

  it('detects OpenAI chat exports', () => {
    const openAIChat: OpenAIChat = {
      title: 'Imported',
      current_node: 'node-1',
      mapping: {
        'node-1': {
          id: 'node-1',
          parent: null,
          children: [],
          message: {
            author: { role: 'user' },
            content: { parts: ['hello'] },
          },
        },
      },
    };

    expect(isOpenAIContent(openAIChat)).toBe(true);
    expect(isOpenAIContent([openAIChat])).toBe(true);
  });
});
