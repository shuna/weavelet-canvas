import { describe, expect, it } from 'vitest';
import { bubbleNavigationTargets, captureBubbleScrollAnchor, restoredBubbleScrollTop, shouldFollowStream, streamFollowAfterScroll } from './bubbleScroll';
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

  it('changes stream following only for a scroll change or a replaced scroller', () => {
    const base = { following: true, previousScrollTop: 600, scrollTop: 600, scrollHeight: 900, clientHeight: 300, scrollEvent: false, scrollerChanged: false };
    expect(streamFollowAfterScroll(base)).toBe(true);
    expect(streamFollowAfterScroll({ ...base, scrollEvent: true, scrollTop: 599.4 })).toBe(false);
    expect(streamFollowAfterScroll({ ...base, scrollerChanged: true })).toBe(true);
    expect(streamFollowAfterScroll({ ...base, scrollEvent: true, previousScrollTop: 10, scrollTop: 0, scrollHeight: 300 })).toBe(false);
  });

  it('does not stream-follow while editing, swiping, or without a session', () => {
    const base = { following: true, generating: true, editing: false, branchSwiping: false };
    expect(shouldFollowStream(base)).toBe(true);
    expect(shouldFollowStream({ ...base, editing: true })).toBe(false);
    expect(shouldFollowStream({ ...base, branchSwiping: true })).toBe(false);
    expect(shouldFollowStream({ ...base, generating: false })).toBe(false);
    expect(JSON.parse(bubbleScroll(JSON.stringify({ operation: 'streamFollow', ...base, previousScrollTop: 10, scrollTop: 0, scrollHeight: 100, clientHeight: 100, scrollEvent: true, scrollerChanged: false })))).toEqual({ following: false, shouldScroll: false });
  });
});
