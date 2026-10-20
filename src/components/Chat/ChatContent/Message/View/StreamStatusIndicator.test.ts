import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const fixture = vi.hoisted(() => ({ state: {} as any }));
vi.mock('@store/store', () => ({ default: (selector: any) => selector(fixture.state) }));
vi.mock('@store/stream-end-status-store', () => ({ useStreamEndStatusStore: (selector: any) => selector({ statuses: {} }) }));
vi.mock('@hooks/useStreamRecovery', () => ({ recoverPending: vi.fn() }));
import StreamStatusIndicator from './StreamStatusIndicator';

beforeEach(() => {
  fixture.state = { proxyEnabled: true, proxyEndpoint: 'https://proxy', chats: [{ id: 'c', branchTree: { nodes: {
    n: { streamState: { reason: 'error', requestId: 'r', proxy: true, createdAt: Date.now() } },
    other: { streamState: { reason: 'completed', createdAt: Date.now() } },
  } } }] };
});
const render = (nodeId = 'n', chatId = 'c') => renderToStaticMarkup(createElement(StreamStatusIndicator, { chatId, nodeId }));
it('renders an interrupted bubble and its recovery button without relying on the footer error', () => {
  expect(render()).toContain('送信エラー');
  expect(render()).toContain('プロキシから復旧');
  expect(render()).toContain('<button');
  expect(render('other')).toContain('完了');
  expect(render('other')).not.toContain('<button');
  expect(render('n', 'wrong-chat')).toBe('');
});
it('treats a persisted streaming state without a live generation as interrupted', () => {
  fixture.state.chats[0].branchTree.nodes.n.streamState.reason = 'streaming';
  expect(render()).toContain('応答が中断されました');
  expect(render()).toContain('<button');
});
it('keeps the incomplete status but removes the action when recovery data has expired', () => {
  fixture.state.chats[0].branchTree.nodes.n.streamState.createdAt -= 8 * 86400000;
  expect(render()).toContain('保持期間が終了');
  expect(render()).not.toContain('<button');
});
