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

    const clone = deepCloneSingleChat(original);

    expect(clone).not.toBe(original);
    expect(clone.id).not.toBe(original.id);
    expect(clone.title).toBe(original.title);
    expect(clone.messages).toEqual(original.messages);
  });
});
