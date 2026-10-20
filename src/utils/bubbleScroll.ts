export type BubbleScrollItem = { index: number; top: number };
export type BubbleAnchorItem = { index: number; nodeId?: string; top: number; bottom: number };
export type BubbleScrollAnchor = {
  firstVisibleItemIndex: number;
  offsetWithinItem: number;
  wasAtBottom: boolean;
  nodeId?: string;
  scrollTop: number;
};

export function bubbleNavigationTargets(input: {
  items: BubbleScrollItem[];
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): { previous: number; next: number } {
  let previous = -1;
  let next = -1;
  const maxScrollTop = Math.max(0, input.scrollHeight - input.clientHeight);
  for (const item of input.items) {
    if (item.top < -0.5) previous = item.index;
    if (next < 0 && Math.min(input.scrollTop + item.top, maxScrollTop) > input.scrollTop + 0.5) next = item.index;
  }
  return { previous, next };
}

export function captureBubbleScrollAnchor(input: {
  items: BubbleAnchorItem[];
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): BubbleScrollAnchor {
  const first = input.items.find(item => item.bottom > 0);
  return {
    firstVisibleItemIndex: first?.index ?? -1,
    offsetWithinItem: first ? -first.top : 0,
    wasAtBottom: input.scrollTop >= input.scrollHeight - input.clientHeight - 0.5,
    ...(first?.nodeId !== undefined ? { nodeId: first.nodeId } : {}),
    scrollTop: input.scrollTop,
  };
}

export function restoredBubbleScrollTop(input: {
  anchor?: Omit<BubbleScrollAnchor, 'scrollTop'> & { scrollTop?: number };
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  itemTop?: number;
}): number | null {
  const { anchor } = input;
  if (!anchor) return null;
  if (anchor.wasAtBottom) return input.scrollHeight;
  if (input.itemTop != null) return input.scrollTop + input.itemTop + anchor.offsetWithinItem;
  return anchor.scrollTop ?? null;
}

export function streamFollowAfterScroll(input: {
  following: boolean;
  previousScrollTop: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollEvent: boolean;
  scrollerChanged: boolean;
}): boolean {
  if (!input.scrollEvent && !input.scrollerChanged) return input.following;
  if (input.scrollTop === input.previousScrollTop && !input.scrollerChanged) return input.following;
  return input.scrollHeight > input.clientHeight + 0.5
    && input.scrollTop >= input.scrollHeight - input.clientHeight - 0.5;
}

export function shouldFollowStream(input: {
  following: boolean;
  generating: boolean;
  editing: boolean;
  branchSwiping: boolean;
}): boolean {
  return input.following && input.generating && !input.editing && !input.branchSwiping;
}
