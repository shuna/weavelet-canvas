import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import useStore from '@store/store';
import { buildPathToLeaf, getSiblingsOf } from '@utils/branchUtils';
import BranchSwipePreview from '@components/Chat/ChatContent/Message/BranchSwipePreview';

type Direction = 'previous' | 'next';
export interface BranchSwipeMotion {
  width: number;
  move: (distance: number) => void;
  finish: (direction: Direction | null) => void;
  dispose: () => void;
}

export function createBranchSwipeMotion(element: HTMLElement, chatIndex: number, nodeId: string): BranchSwipeMotion | null {
  const state = useStore.getState();
  const chat = state.chats?.[chatIndex];
  const tree = chat?.branchTree;
  const item = element.closest<HTMLElement>('[data-item-index]');
  const list = item?.parentElement;
  const scroller = item?.closest<HTMLElement>('[data-chat-scroller]');
  if (!chat || !tree || !item || !list || !scroller || scroller.dataset.branchSwiping) return null;
  const siblings = getSiblingsOf(tree, nodeId);
  const index = siblings.findIndex(node => node.id === nodeId);
  const pathIndex = tree.activePath.indexOf(nodeId);
  if (siblings.length < 2 || index < 0 || pathIndex < 0) return null;
  const sources = Array.from(list.children).slice(Array.from(list.children).indexOf(item)) as HTMLElement[];
  if (sources.some(source => source.querySelector('textarea, [contenteditable="true"]'))) return null;
  const width = list.clientWidth;
  const originalStyles = sources.map(source => source.style.cssText);
  const listStyle = list.style.cssText;
  const scrollerAnchor = scroller.style.overflowAnchor;
  const anchorTop = item.getBoundingClientRect().top;
  const itemIndex = item.dataset.itemIndex;
  const oldHeight = list.getBoundingClientRect().height;
  list.style.height = `${oldHeight}px`;
  list.style.overflow = 'hidden';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const host = document.createElement('div');
  host.dataset.branchSwipePreview = 'true';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  Object.assign(host.style, { position: 'absolute', left: '0', top: `${item.offsetTop}px`, width: '100%', height: `${oldHeight - item.offsetTop}px`, overflow: 'hidden', pointerEvents: 'none' });
  list.append(host);
  const previewRoot = createRoot(host);
  scroller.dataset.branchSwiping = 'true';
  scroller.style.overflowAnchor = 'none';
  let targetId: string | undefined;
  let direction: Direction | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let closing = false;
  let committed = false;
  let previewRemoved = false;
  const restoreSources = () => sources.forEach((source, i) => { source.style.cssText = originalStyles[i]; });
  const removePreview = () => {
    if (previewRemoved) return;
    previewRemoved = true;
    queueMicrotask(() => previewRoot.unmount());
    host.remove();
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    restoreSources();
    list.style.cssText = listStyle;
    scroller.style.overflowAnchor = scrollerAnchor;
    delete scroller.dataset.branchSwiping;
    removePreview();
  };
  const translate = (distance: number, animated = false) => {
    const transition = animated && !reduced ? 'transform 230ms cubic-bezier(.22,.68,.25,1)' : 'none';
    for (const source of sources) {
      source.style.transition = transition;
      source.style.transform = `translateX(${distance}px)`;
      source.style.pointerEvents = 'none';
    }
    host.style.transition = transition;
    host.style.transform = `translateX(${distance + (direction === 'previous' ? width : -width)}px)`;
  };
  const finish = (requested: Direction | null) => {
    if (closing || disposed) return;
    closing = true;
    const accepted = requested === direction && !!targetId;
    translate(accepted ? (direction === 'previous' ? -width : width) : 0, true);
    timer = setTimeout(() => {
      const current = useStore.getState();
      // Navigation, edits or sync that replaced the tree cancel this gesture.
      if (!accepted || current.chats?.[chatIndex]?.branchTree !== tree || current.currentChatIndex !== chatIndex) { cleanup(); return; }
      const newPath = buildPathToLeaf(tree, targetId!);
      restoreSources();
      list.style.height = `${oldHeight}px`;
      list.style.overflow = 'hidden';
      removePreview();
      committed = true;
      flushSync(() => {
        current.pushNavigationEntry({ chatId: chat.id, activePath: newPath, viewContext: current.chatActiveView, source: 'branch-switch' });
        current.switchBranchAtNode(chatIndex, targetId!);
      });
      const replacement = list.querySelector<HTMLElement>(`[data-item-index="${itemIndex}"]`);
      list.style.height = 'auto';
      const newHeight = list.getBoundingClientRect().height;
      list.style.height = `${oldHeight}px`;
      void list.offsetHeight;
      list.style.transition = reduced ? 'none' : 'height 180ms ease';
      list.style.height = `${newHeight}px`;
      if (replacement) scroller.scrollTop += replacement.getBoundingClientRect().top - anchorTop;
      timer = setTimeout(cleanup, reduced ? 0 : 190);
    }, reduced ? 0 : 240);
  };
  return {
    width,
    move: dx => {
      if (closing || disposed) return;
      const nextDirection = dx < 0 ? 'previous' : 'next';
      if (nextDirection !== direction) {
        direction = nextDirection;
        targetId = siblings[index + (direction === 'previous' ? -1 : 1)]?.id;
        flushSync(() => previewRoot.render(targetId ? createElement(BranchSwipePreview, { tree, path: buildPathToLeaf(tree, targetId), startIndex: pathIndex, chatIndex }) : null));
      }
      translate(targetId ? Math.max(-width, Math.min(width, dx)) : Math.sign(dx) * Math.min(32, Math.abs(dx) * .18));
    },
    finish,
    // The source row unmounts during commit; finish its height animation rather
    // than tearing it down from that row's effect cleanup.
    dispose: () => { if (!committed) cleanup(); },
  };
}
