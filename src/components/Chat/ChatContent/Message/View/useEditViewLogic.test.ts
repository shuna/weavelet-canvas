import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useEditViewLogic } from './useEditViewLogic';

const mocks = vi.hoisted(() => ({ save: vi.fn(), submit: vi.fn(), append: vi.fn() }));
vi.mock('@hooks/useSubmit', () => ({ default: () => ({ handleSubmit: mocks.submit }) }));
vi.mock('@utils/chatModelResolution', () => ({
  resolveChatModel: () => ({ status: 'available' }),
  confirmChatModelFavorite: () => true,
}));
vi.mock('@store/store', () => {
  const state = {
    currentChatIndex: 0,
    chats: [{ id: 'chat', config: { model: 'test' }, messages: [{ role: 'user' }] }],
    generatingSessions: {},
    protectedNodeMaps: {},
    enterToSubmit: true,
    upsertWithAutoBranch: mocks.save,
    appendNodeToActivePath: mocks.append,
  };
  return { default: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }) };
});

describe('edit Enter shortcuts', () => {
  it.each([false, true])('ignores IME Enter and allows the next ordinary Enter (sticky=%s)', sticky => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { userAgent: 'Macintosh Safari' });
    let logic!: ReturnType<typeof useEditViewLogic>;
    const setIsEdit = vi.fn();
    function Harness() {
      logic = useEditViewLogic({
        content: [{ type: 'text', text: '日本語' }],
        setIsEdit,
        messageIndex: 0,
        editSessionKey: `ime-${sticky}`,
        sticky,
      });
      return null;
    }
    renderToString(React.createElement(Harness));
    const enter = { key: 'Enter', isComposing: false, keyCode: 13, preventDefault: vi.fn() };
    try {
      for (const ime of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
        for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
          const nativeEvent = { ...enter, ...ime, ...modifiers } as unknown as KeyboardEvent;
          logic.handleKeyDown(nativeEvent);
          logic.handleKeyDown({ ...nativeEvent, nativeEvent } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
        }
      }
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.append).not.toHaveBeenCalled();
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(setIsEdit).not.toHaveBeenCalled();
      expect(enter.preventDefault).not.toHaveBeenCalled();

      logic.handleKeyDown(enter as unknown as KeyboardEvent);
      expect(sticky ? mocks.submit : mocks.save).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
