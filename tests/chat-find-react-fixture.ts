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
