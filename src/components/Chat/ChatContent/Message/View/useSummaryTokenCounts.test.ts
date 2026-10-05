import { expect, it } from 'vitest';
import { summaryTokenLabel } from './useSummaryTokenCounts';
it('shows savings, expansion and original counts without masking increases', () => {
  expect(summaryTokenLabel(1212, 3673)).toBe('1212 tokens, 67%');
  expect(summaryTokenLabel(120, 100)).toBe('120 tokens, -20%');
  expect(summaryTokenLabel(0, 0)).toBe('0 tokens, 0%');
  expect(summaryTokenLabel(3673, 3673, true)).toBe('3673 tokens');
});
