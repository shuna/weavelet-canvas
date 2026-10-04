import { useEffect, useRef } from 'react';
import useBranchNavigation from './useBranchNavigation';

// Native touchmove must be non-passive to suppress scrolling only after a
// horizontal gesture is established. React's touch listeners are passive.
export function bindMessageBranchSwipe(
  element: HTMLElement,
  onSwipe: (direction: 'previous' | 'next') => void
) {
  let start: { x: number; y: number } | null = null;
  let horizontal = false;
  let suppressClick = false;

  const reset = () => {
    start = null;
    horizontal = false;
  };
  const onStart = (event: TouchEvent) => {
    reset();
    suppressClick = false;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    // Leave edge gestures to the sidebar and browser navigation.
    if (touch.clientX <= 20 || touch.clientX >= window.innerWidth - 20) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"], pre, code, table, [role="slider"]')) return;
    if (element.querySelector('textarea, [contenteditable="true"]')) return;
    if (window.getSelection()?.toString()) return;
    for (let current: HTMLElement | null = target; current && current !== element; current = current.parentElement) {
      if (current.scrollWidth > current.clientWidth && /auto|scroll/.test(getComputedStyle(current).overflowX)) return;
    }
    start = { x: touch.clientX, y: touch.clientY };
  };
  const onMove = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1 || window.getSelection()?.toString()) {
      reset();
      return;
    }
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (!horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
        reset();
        return;
      }
      horizontal = true;
      suppressClick = true;
    }
    if (event.cancelable) event.preventDefault();
  };
  const onEnd = (event: TouchEvent) => {
    if (start && horizontal && event.changedTouches.length === 1 && !window.getSelection()?.toString()) {
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        onSwipe(dx < 0 ? 'previous' : 'next');
      }
    }
    reset();
  };
  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('touchstart', onStart, { passive: true });
  element.addEventListener('touchmove', onMove, { passive: false });
  element.addEventListener('touchend', onEnd);
  element.addEventListener('touchcancel', reset);
  element.addEventListener('click', onClick, true);
  return () => {
    element.removeEventListener('touchstart', onStart);
    element.removeEventListener('touchmove', onMove);
    element.removeEventListener('touchend', onEnd);
    element.removeEventListener('touchcancel', reset);
    element.removeEventListener('click', onClick, true);
  };
}

export default function useMessageBranchSwipe(chatIndex: number, nodeId?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const { siblings, currentIdx, switchTo } = useBranchNavigation(chatIndex, nodeId);
  const navigation = useRef({ siblings, currentIdx, switchTo });
  navigation.current = { siblings, currentIdx, switchTo };
  const enabled = currentIdx >= 0 && siblings.length > 1;

  useEffect(() => {
    if (!enabled || !ref.current) return;
    return bindMessageBranchSwipe(ref.current, (direction) => {
      const { siblings, currentIdx, switchTo } = navigation.current;
      const target = siblings[currentIdx + (direction === 'next' ? 1 : -1)];
      if (target) switchTo(target.id);
    });
  }, [enabled, nodeId, chatIndex]);

  return ref;
}
