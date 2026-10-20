import { describe, expect, it } from 'vitest';
import { bubbleNavigationTargets, captureBubbleScrollAnchor, restoredBubbleScrollTop } from './bubbleScroll';
import { bubbleScroll } from '../../shared/google-sync/bubbleScroll';

describe('bubbleNavigationTargets', () => {
  const input = { items: [{ index: 0, top: -100 }, { index: 1, top: 100 }, { index: 2, top: 300 }], scrollTop: 100, scrollHeight: 900, clientHeight: 300 };

  it('keeps the Web adjacent targets and half-pixel tolerance', () => {
    expect(bubbleNavigationTargets(input)).toEqual({ previous: 0, next: 1 });
    expect(bubbleNavigationTargets({ ...input, items: [{ index: 7, top: -0.5 }, { index: 8, top: 0.5 }] })).toEqual({ previous: -1, next: -1 });
  });

  it('uses the same native bridge result', () => {
    expect(JSON.parse(bubbleScroll(JSON.stringify(input)))).toEqual(bubbleNavigationTargets(input));
  });

  it('captures the first positive-bottom item and restores its exact offset', () => {
    const capture = { operation: 'capture', items: [{ index: 2, nodeId: 'hidden', top: -50, bottom: 0 }, { index: 3, nodeId: 'visible', top: -50, bottom: 10 }], scrollTop: 120, scrollHeight: 900, clientHeight: 300 };
    const anchor = captureBubbleScrollAnchor(capture);
    expect(anchor).toEqual({ firstVisibleItemIndex: 3, nodeId: 'visible', offsetWithinItem: 50, wasAtBottom: false, scrollTop: 120 });
    expect(restoredBubbleScrollTop({ anchor, scrollTop: 20, scrollHeight: 900, clientHeight: 300, itemTop: -30 })).toBe(40);
    expect(JSON.parse(bubbleScroll(JSON.stringify(capture)))).toEqual(anchor);
  });

  it('restores the bottom or saved raw scroll position when no item is available', () => {
    expect(restoredBubbleScrollTop({ anchor: { firstVisibleItemIndex: -1, offsetWithinItem: 0, wasAtBottom: true, scrollTop: 12 }, scrollTop: 0, scrollHeight: 700, clientHeight: 300 })).toBe(700);
    expect(JSON.parse(bubbleScroll(JSON.stringify({ operation: 'restore', anchor: { firstVisibleItemIndex: -1, offsetWithinItem: 0, wasAtBottom: false, scrollTop: 12 }, scrollTop: 0, scrollHeight: 700, clientHeight: 300 })))).toBe(12);
  });
});
