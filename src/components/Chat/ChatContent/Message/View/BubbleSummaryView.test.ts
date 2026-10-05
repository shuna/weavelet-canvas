import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BubbleSummaryView from './BubbleSummaryView';
const mocks = vi.hoisted(() => ({ value: {} as any, choose: vi.fn() }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useEffect: vi.fn(), useState: () => [undefined, vi.fn()] }));
vi.mock('@store/store', () => ({ default: (selector: any) => selector({ markdownMode: false, inlineLatex: false }) }));
vi.mock('@utils/messageUtils', () => ({ countTokens: vi.fn(), loadEncoder: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./bubbleSummaryDisplay', () => ({ useBubbleSummary: () => mocks.value, useSummaryDisplay: (selector: any) => selector({ choose: mocks.choose }) }));
beforeEach(() => { mocks.value = { chat: { id: 'chat', config: { model: 'model' } }, candidates: [], summary: { sources: [{ nodeId: 'a' }, { nodeId: 'b' }], format: 'compact', text: 'Compressed', useForSubmit: true }, range: { first: 0, last: 1 }, tab: 'compact' }; });
it('shows compact text in the same pane as readable summaries and hides original bubbles', () => {
  for (const nodeId of ['a', 'b']) {
    const html = renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId, children: 'Original' }));
    expect(html).toContain('<div hidden="">Original</div>');
    if (nodeId === 'b') {
      expect(html).toContain('data-summary-content');
      expect(html).toContain('Compressed');
      expect(html).toContain('圧縮を編集');
      expect(html).not.toContain('<details');
    }
  }
});
it('provides the same editing action for readable summaries and restores originals on original tab', () => {
  mocks.value.summary.format = undefined; mocks.value.tab = 'summary';
  expect(renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId: 'b', children: 'Original' }))).toContain('要約を編集');
  mocks.value.summary.format = 'compact'; mocks.value.tab = 'original';
  expect(renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId: 'b', children: 'Original' }))).toContain('<div>Original</div>');
});

it('lists saved versions only for the current format', () => {
  const compact = { ...mocks.value.summary, id: 'compact' };
  mocks.value.summary = { ...compact, id: 'readable', format: undefined };
  mocks.value.candidates = [mocks.value.summary, compact]; mocks.value.tab = 'summary';
  const html = renderToStaticMarkup(createElement(BubbleSummaryView, { nodeId: 'b', children: 'Original' }));
  expect(html).not.toContain('保存済み要約');
});
