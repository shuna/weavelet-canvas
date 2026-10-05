import { expect, it, vi } from 'vitest';
import { SummarySettingsFields } from './SummarySettings';
const state = vi.hoisted(() => ({ bubbleSummaryConfig: { model: 'custom' }, setBubbleSummaryConfig: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: () => [false, vi.fn()] }));
vi.mock('@store/store', () => ({ default: Object.assign((select: any) => select(state), { getState: () => state }) }));
vi.mock('@components/ConfigMenu', () => ({ default: () => null }));
vi.mock('@hooks/submitHelpers', () => ({ isLocalModelConfig: () => false }));
it('resets dedicated summary configuration to chat settings without touching other storage', () => {
  const view = SummarySettingsFields({ config: { model: 'chat' } as any });
  const fieldset = view.props.children[0];
  const reset = fieldset.props.children.find((child: any) => child?.type === 'button' && child.props.children === 'デフォルトにリセット');
  reset.props.onClick();
  expect(state.setBubbleSummaryConfig).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(state.bubbleSummaryConfig.model).toBe('custom');
});
