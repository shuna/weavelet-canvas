import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BubbleSummaryView from './BubbleSummaryView';
const mocks = vi.hoisted(() => ({ value: {} as any, choose: vi.fn() }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useEffect: vi.fn(), useState: () => [undefined, vi.fn()] }));
vi.mock('@store/store', () => ({ default: (selector: any) => selector({ markdownMode: false, inlineLatex: false }) }));
vi.mock('@utils/messageUtils', () => ({ countTokens: vi.fn(), loadEncoder: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./bubbleSummaryDisplay', () => ({ useBubbleSummary: () => mocks.value, useSummaryDisplay: (selector: any) => selector({ choose: mocks.choose }) }));
beforeEach(() => { mocks.value = { chat: { id: 'chat', config: { model: 'model' } }, candidates: [], summary: { sources: [{ nodeId: 'a' }, { nodeId: 'b' }], format: 'compact', text: 'Compressed', useForSubmit: true }, range: { first: 0, last: 1 }, tab: 'summary' }; });
it('keeps both original bubbles visible while compact history is sent', () => {
  for (const nodeId of ['a', 'b']) {
    const html = renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId, children: 'Original' }));
    expect(html).toContain('<div>Original</div>');
    expect(html).not.toContain('<div hidden="">Original</div>');
    if (nodeId === 'b') expect(html).toContain('送信に使用中');
  }
});
it('keeps readable-summary display behavior and indicates disabled compact submission', () => {
  mocks.value.summary.format = undefined;
  expect(renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId: 'b', children: 'Original' }))).toContain('<div hidden="">Original</div>');
  mocks.value.summary.format = 'compact'; mocks.value.tab = 'original';
  expect(renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId: 'b', children: 'Original' }))).toContain('原文を送信');
});

it('selects a saved compact version for review without enabling submission', () => {
  const compact = { ...mocks.value.summary, id: 'compact' };
  mocks.value.summary = { ...compact, id: 'readable', format: undefined };
  mocks.value.candidates = [mocks.value.summary, compact];
  const view = BubbleSummaryView({ nodeId: 'b', children: 'Original' }) as any;
  const select = view.props.children[0].props.children[1];
  select.props.onChange({ target: { value: 'compact' } });
  expect(mocks.choose).toHaveBeenCalledWith('chat', compact, false);
});
