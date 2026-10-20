import { bubbleNavigationTargets, captureBubbleScrollAnchor, restoredBubbleScrollTop, shouldFollowStream, streamFollowAfterScroll } from '../../src/utils/bubbleScroll';

export function bubbleScroll(json: string): string {
  const input = JSON.parse(json);
  if (input.operation === 'capture') return JSON.stringify(captureBubbleScrollAnchor(input));
  if (input.operation === 'restore') return JSON.stringify(restoredBubbleScrollTop(input));
  if (input.operation === 'streamFollow') {
    const following = streamFollowAfterScroll(input);
    return JSON.stringify({ following, shouldScroll: shouldFollowStream({ ...input, following }) });
  }
  return JSON.stringify(bubbleNavigationTargets(input));
}
