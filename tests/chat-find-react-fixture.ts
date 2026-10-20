import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { clearChatFind, highlightChatFind } from '../src/utils/chatFindDom';

export async function exerciseReactChatFind(clearBeforeUpdate: boolean) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  const render = (text: string, mixed: boolean) => flushSync(() => root.render(
    React.createElement('p', null, text, mixed ? React.createElement('b', null, ' suffix') : null),
  ));
  const stages: string[] = [];
  try {
    render('banana', true);
    highlightChatFind(element, 'ana');
    if (clearBeforeUpdate) clearChatFind(element);
    render('updated banana', true);
    await Promise.resolve();
    stages.push(element.textContent ?? '');
    clearChatFind(element);
    stages.push(element.textContent ?? '');
    const count = highlightChatFind(element, 'ana').length;
    if (clearBeforeUpdate) clearChatFind(element);
    render('final', false);
    await Promise.resolve();
    clearChatFind(element);
    stages.push(element.textContent ?? '');
    highlightChatFind(element, 'final');
    if (clearBeforeUpdate) clearChatFind(element);
    flushSync(() => root.render(React.createElement('p', null, React.createElement('i', null, 'replacement'))));
    await Promise.resolve();
    clearChatFind(element);
    stages.push(element.textContent ?? '');
    return { stages, count, error: null };
  } catch (error) {
    return { stages, count: -1, error: String(error) };
  } finally {
    flushSync(() => root.unmount());
    element.remove();
  }
}

export async function mountWebChatFind() {
  const [{ default: ChatFindBar }, { WorkspaceContext }, { default: liveStore }, { create }] = await Promise.all([
    import('../src/components/Chat/ChatContent/ChatFindBar'), import('../src/store/workspaceScope'),
    import('../src/store/store'), import('zustand'),
  ]);
  let history = 0, scrolls = 0;
  const store = create(() => ({ ...liveStore.getInitialState(),
    chats: [{ id: 'find-test', title: 'Find test', messages: [] }], currentChatIndex: 0,
    pushNavigationEntry: () => { history++; },
    navigateToNode: () => { history++; return 'reached'; },
  }));
  const scroller = document.createElement('div');
  scroller.id = 'chat-find-fixture';
  scroller.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;height:400px;overflow:auto';
  scroller.scrollTo = () => { scrolls++; };
  const body = document.createElement('div'), bar = document.createElement('div');
  body.dataset.findBody = '';
  body.style.paddingTop = '80px';
  scroller.append(body, bar);
  document.body.appendChild(scroller);
  const bodyRoot = createRoot(body), barRoot = createRoot(bar);
  const renderBody = (text: string, label = 'Copy code') => flushSync(() => bodyRoot.render(
    React.createElement('section', null, React.createElement('p', null, text),
      React.createElement('button', { onClick: () => renderBody(text, 'Copied!') }, label)),
  ));
  renderBody('banana banana');
  flushSync(() => barRoot.render(React.createElement(WorkspaceContext.Provider, {
    value: { store: store as typeof liveStore, readOnly: false, selectedIds: [], setSelectedIds: () => {}, selectedFolderIds: [], setSelectedFolderIds: () => {} },
  }, React.createElement(ChatFindBar, { scrollerRef: { current: scroller }, onClose: () => {} }))));
  return {
    update: renderBody,
    enableNodeSearch: () => store.setState({
      chats: [{ id: 'find-test', title: 'Find test', messages: [], branchTree: {
        rootId: 'message', activePath: ['message'], nodes: {
          message: { id: 'message', parentId: null, role: 'assistant', contentHash: 'body' },
        },
      } }],
      contentStore: { body: { content: [{ type: 'text', text: 'banana banana' }] } },
    } as any),
    counters: () => ({ history, scrolls }),
    unmount: () => {
      flushSync(() => barRoot.unmount());
      flushSync(() => bodyRoot.unmount());
      scroller.remove();
    },
  };
}
