import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applyBubbleSummariesForSubmit } from '@utils/bubbleSummary';
import { useEditViewLogic } from './useEditViewLogic';

const mocks = vi.hoisted(() => ({ save: vi.fn(), submit: vi.fn(), append: vi.fn(), summarySave: vi.fn(), remove: vi.fn(), midchat: vi.fn(), truncate: vi.fn(), state: {} as any }));
vi.mock('@hooks/useSubmit', () => ({ default: () => ({ handleSubmit: mocks.submit, handleSubmitMidChat: mocks.midchat }) }));
vi.mock('@utils/chatModelResolution', () => ({
  resolveChatModel: () => ({ status: 'available' }),
  confirmChatModelFavorite: () => true,
}));
vi.mock('@store/store', () => {
  const state = mocks.state = {
    currentChatIndex: 0,
    chats: [{ id: 'chat', config: { model: 'test' }, messages: [{ role: 'user' }] }],
    generatingSessions: {},
    protectedNodeMaps: {},
    omittedNodeMaps: {},
    saveBubbleSummary: mocks.summarySave,
    removeMessageAtIndex: mocks.remove,
    truncateActivePathAt: mocks.truncate,
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


describe('editing the selected summary through the common editor', () => {
  function harness(format?: 'compact') {
    vi.clearAllMocks();
    const state = mocks.state;
    state.chats = [{ id: 'chat', config: { model: 'test' }, messages: [
      { role: 'user', content: [{ type: 'text', text: 'Original user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Original answer' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Following answer' }] },
    ], summaries: [{ id: 'summary', mode: 'range', format, text: 'Before edit', useForSubmit: true, sources: [
      { nodeId: '0', parentId: null, role: 'user', textParts: ['Original user'] },
      { nodeId: '1', parentId: null, role: 'assistant', textParts: ['Original answer'] },
    ] }] }];
    mocks.summarySave.mockImplementation((_chatId, summary) => { state.chats[0].summaries = [summary]; });
    mocks.remove.mockImplementation((_index, messageIndex) => state.chats[0].messages.splice(messageIndex, 1));
    let logic!: ReturnType<typeof useEditViewLogic>;
    renderToString(React.createElement(() => { logic = useEditViewLogic({ content: [{ type: 'text', text: 'Edited displayed text' }], setIsEdit: vi.fn(), messageIndex: 1, nodeId: '1', summaryId: 'summary', editSessionKey: `summary-${format}-${mocks.summarySave.mock.calls.length}` }); return null; }));
    return { logic, state };
  }
  it.each([undefined, 'compact' as const])('saves %s without rewriting its original bubbles', format => {
    const { logic, state } = harness(format);
    const originals = structuredClone(state.chats[0].messages);
    logic.handleSave();
    expect(mocks.summarySave).toHaveBeenCalledWith('chat', expect.objectContaining({ text: 'Edited displayed text', format }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(state.chats[0].messages).toEqual(originals);
  });
  it.each([undefined, 'compact' as const])('generates from edited %s context and removes only the following response', format => {
    const { logic, state } = harness(format);
    logic.handleGenerateNextOnly();
    expect(mocks.midchat).toHaveBeenCalledWith(2);
    expect(mocks.remove).toHaveBeenCalledWith(0, 2);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(state.chats[0].messages.map((message: any) => message.content[0].text)).toEqual(['Original user', 'Original answer']);
    const sent = applyBubbleSummariesForSubmit(state.chats[0], 2);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContainEqual({ type: 'text', text: expect.stringContaining('Edited displayed text') });
  });
  it.each([undefined, 'compact' as const])('generates a new response from %s without deleting existing responses', format => {
    const { logic, state } = harness(format);
    const originals = structuredClone(state.chats[0].messages);
    logic.handleBranchGenerate();
    expect(mocks.summarySave).toHaveBeenCalledWith('chat', expect.objectContaining({ text: 'Edited displayed text' }));
    expect(mocks.truncate).toHaveBeenCalledWith(0, '1');
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(state.chats[0].messages).toEqual(originals);
  });
  it('refuses stale or deselected summary edits and generation', () => {
    const { logic, state } = harness('compact');
    state.chats[0].messages[0].content[0].text = 'Changed original';
    logic.handleGenerateNextOnly();
    expect(mocks.summarySave).not.toHaveBeenCalled();
    expect(mocks.midchat).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    state.chats[0].messages[0].content[0].text = 'Original user';
    state.chats[0].summaries[0].useForSubmit = false;
    logic.handleSave();
    expect(mocks.summarySave).not.toHaveBeenCalled();
  });
});
