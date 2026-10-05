import { beforeEach, expect, it, vi } from 'vitest';
import Controls from './BubbleSummaryControls';
const mocks = vi.hoisted(() => ({ value: {} as any, job: undefined as any, start: vi.fn(), open: vi.fn(), change: vi.fn() }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<any>(), useState: () => [false, mocks.open], useMemo: (factory: any) => factory(), useRef: () => ({ current: null }) }));
vi.mock('./useSummaryTokenCounts', () => ({ default: () => undefined, summaryTokenLabel: () => '' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@components/PopupModal', () => ({ default: () => null }));
vi.mock('@components/SummarySettings', () => ({ SummarySettingsFields: () => null }));
vi.mock('@hooks/submitHelpers', () => ({ isLocalModelConfig: () => false }));
vi.mock('@store/store', () => {
 const state = { chats: [{ branchTree: { activePath: ['a'] } }], currentChatIndex: 0, providers: {}, favoriteModels: [], bubbleSummaryConfig: { model: 'summary-model' } };
 return { default: Object.assign((selector: any) => selector(state), { getState: () => state }) };
});
vi.mock('./bubbleSummaryDisplay', () => ({ useBubbleSummary: () => mocks.value }));
vi.mock('./bubbleSummaryGeneration', () => ({ startBubbleSummary: mocks.start, useBubbleSummaryJob: () => mocks.job, useSummaryGeneration: { getState: () => ({ jobs: {} }) } }));
beforeEach(() => {
 vi.clearAllMocks(); mocks.job = undefined;
 const chat = { id: 'chat', messages: [{ role: 'user', content: [{ type: 'text', text: 'Original' }] }] };
 mocks.value = { chat, effectiveChat: chat, generating: [], tab: 'original', changeTab: mocks.change };
});
function click(format: number) {
 const view = Controls({ messageIndex: 0 });
 const group = (view.props.children as any[])[0].props.children[1];
 group.props.children[1][format].props.onClick({ stopPropagation: vi.fn() });
}
it.each([0, 1])('starts format %s immediately for only the clicked bubble', format => {
 click(format);
 expect(mocks.start).toHaveBeenCalledWith(mocks.value.chat, [0], 'single', 'a', expect.objectContaining({ summaryFormat: format ? 'compact' : undefined, summaryConfig: { model: 'summary-model' } }));
 expect(mocks.open).not.toHaveBeenCalled();
});
it('switches a saved format without regenerating or opening the dialog', () => {
 mocks.value.range = { first: 0, last: 0 }; mocks.value.readable = { id: 'saved' };
 click(0);
 expect(mocks.change).toHaveBeenCalledWith('summary'); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
});
it('does not start another job while busy or for omitted sources', () => {
 mocks.job = { busy: true }; click(0);
 mocks.job = undefined; mocks.value.effectiveChat.omittedNodes = { a: true }; click(1);
 expect(mocks.start).not.toHaveBeenCalled();
});
