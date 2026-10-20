import { bubbleNavigationTargets } from '../../src/utils/bubbleScroll';

export function bubbleScroll(json: string): string {
  return JSON.stringify(bubbleNavigationTargets(JSON.parse(json)));
}
