import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindMessageBranchSwipe } from './useMessageBranchSwipe';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let selection = '';
  vi.stubGlobal('window', { innerWidth: 400, getSelection: () => ({ toString: () => selection }) });
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'auto' }));
  const element = Object.assign(new EventTarget(), {
    closest: vi.fn(() => null),
    querySelector: vi.fn(() => null),
  });
  const switchBranch = vi.fn();
  const cleanup = bindMessageBranchSwipe(element as unknown as HTMLElement, switchBranch);
  const touch = (type: string, x: number, y: number, count = 1, target: unknown = element) => {
    const event = new Event(type, { cancelable: true });
    const touches = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : touches },
      changedTouches: { value: touches },
      target: { value: target },
    });
    element.dispatchEvent(event);
    return event;
  };
  return { element, switchBranch, touch, cleanup, select: (text: string) => { selection = text; } };
}

describe('message branch swipe', () => {
  it('switches once on release in either direction and consumes the gesture click', () => {
    const { element, touch, switchBranch } = setup();
    touch('touchstart', 200, 100);
    expect(touch('touchmove', 100, 105).defaultPrevented).toBe(true);
    expect(switchBranch).not.toHaveBeenCalled();
    touch('touchend', 100, 105);
    expect(switchBranch.mock.calls).toEqual([['previous']]);
    const click = new Event('click', { cancelable: true });
    element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    touch('touchstart', 100, 100);
    touch('touchmove', 200, 100);
    touch('touchend', 200, 100);
    expect(switchBranch.mock.calls).toEqual([['previous'], ['next']]);
  });

  it('leaves vertical and diagonal scrolling alone, even if it later turns horizontal', () => {
    for (const [x, y] of [[205, 150], [230, 130]]) {
      const { touch, switchBranch } = setup();
      touch('touchstart', 200, 100);
      expect(touch('touchmove', x, y).defaultPrevented).toBe(false);
      touch('touchmove', 100, y);
      touch('touchend', 100, y);
      expect(switchBranch).not.toHaveBeenCalled();
    }
  });

  it('ignores short, cancelled, multi-touch and edge gestures', () => {
    const { touch, switchBranch } = setup();
    touch('touchstart', 200, 100);
    touch('touchmove', 170, 100);
    touch('touchend', 170, 100);
    touch('touchstart', 200, 100);
    touch('touchmove', 100, 100);
    touch('touchcancel', 100, 100);
    touch('touchend', 100, 100);
    touch('touchstart', 200, 100);
    touch('touchmove', 100, 100, 2);
    touch('touchend', 100, 100);
    for (const x of [10, 390]) {
      touch('touchstart', x, 100);
      touch('touchmove', 200, 100);
      touch('touchend', 200, 100);
    }
    expect(switchBranch).not.toHaveBeenCalled();
  });

  it('excludes controls, editors, text selection and horizontal scroll containers', () => {
    const { element, touch, select, switchBranch } = setup();
    const gesture = (target: unknown = element) => {
      touch('touchstart', 200, 100, 1, target);
      touch('touchmove', 100, 100);
      touch('touchend', 100, 100);
    };
    element.closest.mockReturnValueOnce({} as never);
    gesture();
    element.querySelector.mockReturnValueOnce({} as never);
    gesture();
    select('selected text');
    gesture();
    select('');
    gesture({ closest: () => null, scrollWidth: 600, clientWidth: 200, parentElement: element });
    touch('touchstart', 200, 100);
    select('long press selection');
    touch('touchmove', 100, 100);
    touch('touchend', 100, 100);
    expect(switchBranch).not.toHaveBeenCalled();
  });

  it('removes all gesture listeners on cleanup', () => {
    const { touch, cleanup, switchBranch } = setup();
    cleanup();
    touch('touchstart', 200, 100);
    touch('touchmove', 100, 100);
    touch('touchend', 100, 100);
    expect(switchBranch).not.toHaveBeenCalled();
  });
});
