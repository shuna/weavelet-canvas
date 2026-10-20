export type BubbleScrollItem = { index: number; top: number };

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
