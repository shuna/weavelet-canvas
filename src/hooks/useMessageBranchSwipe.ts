import { useEffect, useRef } from 'react';
import { createBranchSwipeMotion, BranchSwipeMotion } from './branchSwipeMotion';
import { resolveBranchSwipeDirection } from '@utils/branchUtils';
import type { BranchSwipeDirection } from '@type/chat';

// Native touchmove must be non-passive to suppress scrolling only after a
// horizontal gesture is established. React's touch listeners are passive.
export function bindMessageBranchSwipe(
  element: HTMLElement,
  onSwipe: (direction: 'previous' | 'next' | null) => void,
  motionOptions: {
    begin?: () => boolean;
    width?: () => number;
    move?: (distance: number) => void;
    cancel?: () => void;
    preference?: () => BranchSwipeDirection;
  } = {}
) {
  let start: { x: number; y: number } | null = null;
  let horizontal = false;
  let suppressClickUntil = 0;
  let samples: { x: number; time: number }[] = [];

  const reset = () => {
    start = null;
    horizontal = false;
    samples = [];
  };
  const cancel = () => {
    if (horizontal) motionOptions.cancel?.();
    reset();
  };
  const onStart = (event: TouchEvent) => {
    cancel();
    suppressClickUntil = 0;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    // Leave edge gestures to the sidebar and browser navigation.
    if (touch.clientX <= 20 || touch.clientX >= window.innerWidth - 20) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, img, [contenteditable="true"], pre, code, table, [role="slider"], [role="button"]')) return;
    if (element.querySelector('textarea, [contenteditable="true"]')) return;
    if (window.getSelection()?.toString()) return;
    for (let current: HTMLElement | null = target; current && current !== element; current = current.parentElement) {
      if (current.scrollWidth > current.clientWidth && /auto|scroll/.test(getComputedStyle(current).overflowX)) return;
    }
    start = { x: touch.clientX, y: touch.clientY };
    samples = [{ x: touch.clientX, time: performance.now() }];
  };
  const onMove = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1 || window.getSelection()?.toString()) {
      cancel();
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
      if (motionOptions.begin && !motionOptions.begin()) { reset(); return; }
      horizontal = true;
    }
    const now = performance.now();
    samples.push({ x: event.touches[0].clientX, time: now });
    samples = samples.filter(sample => now - sample.time <= 100);
    suppressClickUntil = Date.now() + 500;
    if (event.cancelable) event.preventDefault();
    motionOptions.move?.(dx);
  };
  const onEnd = (event: TouchEvent) => {
    if (start && horizontal && event.changedTouches.length === 1 && !window.getSelection()?.toString()) {
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      const width = motionOptions.width?.() ?? element.clientWidth;
      const first = samples[0];
      const velocity = first ? (event.changedTouches[0].clientX - first.x) / Math.max(1, performance.now() - first.time) : 0;
      const distanceCommit = Math.abs(dx) >= width * .30;
      const flickCommit = Math.abs(dx) >= width * .08 && Math.abs(velocity) >= .55 && Math.sign(dx) === Math.sign(velocity);
      motionOptions.move?.(dx);
      onSwipe(Math.abs(dx) > Math.abs(dy) * 1.5 && (distanceCommit || flickCommit) ? resolveBranchSwipeDirection(dx, motionOptions.preference?.()) : null);
    } else if (horizontal) {
      motionOptions.cancel?.();
    }
    reset();
  };
  const onClick = (event: MouseEvent) => {
    if (Date.now() >= suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('touchstart', onStart, { passive: true });
  element.addEventListener('touchmove', onMove, { passive: false });
  element.addEventListener('touchend', onEnd);
  element.addEventListener('touchcancel', cancel);
  element.addEventListener('click', onClick, true);
  return () => {
    cancel();
    element.removeEventListener('touchstart', onStart);
    element.removeEventListener('touchmove', onMove);
    element.removeEventListener('touchend', onEnd);
    element.removeEventListener('touchcancel', cancel);
    element.removeEventListener('click', onClick, true);
  };
}

export default function useMessageBranchSwipe(chatIndex: number, nodeId?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useRef<BranchSwipeMotion | null>(null);

  useEffect(() => {
    if (!nodeId || !ref.current) return;
    const unbind = bindMessageBranchSwipe(ref.current, direction => motion.current?.finish(direction), {
      begin: () => {
        motion.current = createBranchSwipeMotion(ref.current!, chatIndex, nodeId);
        return !!motion.current;
      },
      width: () => motion.current?.width ?? 0,
      preference: () => motion.current?.preference ?? 'left-next',
      move: distance => motion.current?.move(distance),
      cancel: () => motion.current?.finish(null),
    });
    return () => { unbind(); motion.current?.dispose(); };
  }, [nodeId, chatIndex]);

  return ref;
}
