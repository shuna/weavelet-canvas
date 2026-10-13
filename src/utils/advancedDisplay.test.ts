import { describe, expect, it } from 'vitest';
import { isMessageVisible } from './advancedDisplay';

describe('the existing conversation/image display condition', () => {
  it('only hides a system at original index zero when advanced mode is false', () => {
    for (const advanced of [true, false]) {
      const roles = ['system', 'user', 'system', 'assistant', 'future'];
      expect(roles.map((role, index) => isMessageVisible(advanced, index, role)))
        .toEqual(roles.map((role, index) => !(!advanced && index === 0 && role === 'system')));
    }
    expect(isMessageVisible(false, 0, 'user')).toBe(true);
    expect(isMessageVisible(false, 0, 'System')).toBe(true);
    expect(isMessageVisible(false, 1, 'system')).toBe(true);
  });
});
