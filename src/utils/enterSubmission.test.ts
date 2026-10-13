import { describe, expect, it } from 'vitest';
import { enterSubmission } from './enterSubmission';

describe('actual edit-view Enter policy', () => {
  const input = { key: 'Enter', isComposing: false, keyCode: 13, isMobile: false,
    ctrlKey: false, shiftKey: false, enterToSubmit: true, sticky: true };
  it.each([
    [{}, 'generate'],
    [{ sticky: false }, 'save'],
    [{ shiftKey: true }, null],
    [{ enterToSubmit: false }, null],
    [{ enterToSubmit: false, shiftKey: true }, 'generate'],
    [{ enterToSubmit: false, ctrlKey: true, sticky: false }, 'save'],
    [{ ctrlKey: true, shiftKey: true, sticky: false }, 'generate'],
    [{ enterToSubmit: false, ctrlKey: true, shiftKey: true, sticky: false }, 'generate'],
    [{ isComposing: true, ctrlKey: true, shiftKey: true }, null],
    [{ keyCode: 229 }, null],
    [{ isMobile: true, ctrlKey: true, shiftKey: true }, null],
    [{ key: 'a' }, null],
  ] as const)('preserves action for %j', (changes, action) => {
    expect(enterSubmission({ ...input, ...changes })).toBe(action);
  });
});
