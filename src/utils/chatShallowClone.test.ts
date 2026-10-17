import { describe, expect, it } from 'vitest';

import { deepCloneSingleChat } from './chatShallowClone';
import type { ChatInterface } from '@type/chat';

describe('deepCloneSingleChat', () => {
  it('assigns a new chat id to clones', () => {
    const original: ChatInterface = {
      id: 'chat-1',
      title: 'Original',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      config: {
        model: '',
        max_tokens: 1000,
        temperature: 1,
        presence_penalty: 0,
        top_p: 1,
        frequency_penalty: 0,
        stream: true,
      },
      titleSet: false,
      imageDetail: 'auto',
    };

    original.branchTree = { rootId: 'n', activePath: ['n'], nodes: { n: {
      id: 'n', parentId: null, role: 'assistant', contentHash: 'hash', createdAt: 1,
      streamState: { reason: 'error', requestId: 'original-request', proxy: true, createdAt: Date.now() },
    } } };
    const clone = deepCloneSingleChat(original);
    expect(clone.branchTree!.nodes.n.streamState).toBeUndefined();
    expect(original.branchTree.nodes.n.streamState?.requestId).toBe('original-request');

    expect(clone).not.toBe(original);
    expect(clone.id).not.toBe(original.id);
    expect(clone.title).toBe(original.title);
    expect(clone.messages).toEqual(original.messages);
  });
});
