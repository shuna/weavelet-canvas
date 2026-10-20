import { bubbleNavigationTargets, captureBubbleScrollAnchor, restoredBubbleScrollTop } from '../../src/utils/bubbleScroll';

export function bubbleScroll(json: string): string {
  const input = JSON.parse(json);
  if (input.operation === 'capture') return JSON.stringify(captureBubbleScrollAnchor(input));
  if (input.operation === 'restore') return JSON.stringify(restoredBubbleScrollTop(input));
  return JSON.stringify(bubbleNavigationTargets(input));
}
