import { useEffect } from 'react';

/**
 * iOS status bar tap-to-scroll-top workaround.
 *
 * iOS Safari scrolls the window when the status bar is tapped, but this app
 * uses overflow-hidden containers so the window is never scrollable.
 * This hook makes #root 1px taller than the viewport and pre-scrolls 1px,
 * then listens for window scroll=0 (status bar tap) to scroll the chat
 * container to top.
 */

/**
 * Returns true when the soft keyboard is likely open.
 *
 * We check two signals:
 * 1. The active element is an editable field (textarea / input / contenteditable).
 * 2. The visual viewport is noticeably shorter than the layout viewport, which
 *    happens when the on-screen keyboard is covering part of the screen.
 *
 * Either condition alone can produce false positives (e.g. an external
 * keyboard with a focused textarea), but together they cover the common
 * scenarios where we must suppress the status-bar scroll-to-top behaviour.
 */
function isSoftKeyboardLikelyOpen(): boolean {
  const el = document.activeElement;
  const isEditable =
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    (el instanceof HTMLElement && el.isContentEditable);

  if (!isEditable) return false;

  // If the VisualViewport API is available, check whether the keyboard is
  // shrinking the visible area.  A 15 % reduction is a conservative threshold
  // that avoids false positives from browser chrome changes.
  if (window.visualViewport) {
    const ratio = window.visualViewport.height / window.innerHeight;
    if (ratio < 0.85) return true;
  }

  // Fallback: if VisualViewport is not available, the fact that an editable
  // element is focused is a strong-enough signal on iOS to suppress.
  return true;
}

export default function useIosStatusBarScroll() {
  useEffect(() => {
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIos) return;

    const root = document.getElementById('root');
    if (!root) return;

    // Make root 1px taller so window becomes scrollable
    root.style.minHeight = 'calc(100% + 1px)';
    window.scrollTo(0, 1);

    const onScroll = () => {
      if (window.scrollY !== 0) return;

      // When the soft keyboard is visible (or was just dismissed), iOS can
      // momentarily reset window.scrollY to 0.  This is NOT a status-bar tap,
      // so we must not scroll the chat to top.
      if (isSoftKeyboardLikelyOpen()) {
        // Still re-prime the 1px offset so the next genuine tap works.
        requestAnimationFrame(() => {
          window.scrollTo(0, 1);
        });
        return;
      }

      // Find the Virtuoso scroller element (it is the scrollable container)
      const scroller = document.querySelector('[data-virtuoso-scroller="true"]');

      if (scroller) {
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Re-set 1px scroll for next tap
      requestAnimationFrame(() => {
        window.scrollTo(0, 1);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      root.style.minHeight = '';
    };
  }, []);
}
