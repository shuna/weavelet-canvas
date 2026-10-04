import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

let state: any;
const ack = vi.fn(async () => true);
const fetchRecovery = vi.fn();

vi.mock('@store/store', () => ({ default: {
  getState: () => state,
  persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
} }));
vi.mock('@utils/proxyClient', async () => {
  const actual = await vi.importActual<typeof import('@utils/proxyClient')>('@utils/proxyClient');
  return { ...actual, fetchProxyRecovery: (...args: unknown[]) => fetchRecovery(...args), sendAck: async () => ack() };
});
vi.mock('@utils/openrouterObservation', () => ({ recordOpenRouterObservation: vi.fn() }));
vi.mock('@utils/openrouterControls', () => ({ observeOpenRouterUsage: () => ({}) }));
vi.mock('@utils/swBridge', () => ({ register: vi.fn() }));
vi.mock('@utils/branchUtils', () => ({ upsertActivePathMessage: vi.fn() }));
vi.mock('@store/debug-store', () => ({ debugReport: vi.fn() }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@store/stream-end-status-store', () => ({ useStreamEndStatusStore: { getState: () => ({ setStatus: vi.fn() }) } }));
vi.mock('@utils/openrouterVerification', () => ({ buildVerifiedStatsKey: () => '', OPENROUTER_VERIFICATION_INITIAL_DELAY_MS: 0 }));

const response = (text: string, status = 200) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status });
const chat = () => ({ id: 'c', config: {}, messages: [{ role: 'assistant', content: [{ type: 'text', text: '' }] }], branchTree: { activePath: ['n'] } });

describe('recoverPending proxy outcomes', () => {
  beforeEach(async () => {
    (globalThis as any).indexedDB = new IDBFactory(); (globalThis as any).IDBKeyRange = IDBKeyRange;
    state = { proxyEnabled: true, proxyEndpoint: 'https://proxy', proxyAuthToken: '', chats: [chat()], generatingSessions: {}, contentStore: {},
      setChats: (chats: any) => { state.chats = chats; }, removeSessionsForChat: vi.fn(), queueVerification: vi.fn() };
    ack.mockClear(); fetchRecovery.mockReset();
  });

  it('keeps pending data on recovery network failure', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ requestId: 'n', chatIndex: 0, messageIndex: 0, bufferedText: 'local', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    fetchRecovery.mockRejectedValue(new Error('offline'));
    await recoverPending();
    expect(await db.getRequest('n')).toMatchObject({ acknowledged: false, bufferedText: 'local' });
    expect(ack).not.toHaveBeenCalled();
  });

  it('restores split think content then ACKs and deletes only after complete terminals', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ requestId: 'ok', chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0, llmSsePartial: '', thinkTagCheckpoint: { state: 'outside', pending: '' } });
    const raw = 'data: {"choices":[{"delta":{"content":"<think>x</think>y"}}]}\n\ndata: [DONE]\n\n';
    fetchRecovery.mockResolvedValue(response(`id: 1\ndata: ${JSON.stringify(raw)}\n\nevent: done\ndata: {"complete":true}\n\n`));
    await recoverPending();
    expect(state.chats[0].messages[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'y' }), expect.objectContaining({ type: 'reasoning', text: 'x' })]));
    expect(ack).toHaveBeenCalledOnce(); expect(await db.getRequest('ok')).toBeUndefined();
  });

  it('restores content blocks and reasoning_details with the normal extraction rules', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ requestId: 'blocks', chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    const raw = 'data: {"choices":[{"delta":{"content":[{"type":"thinking","text":"hidden"},{"type":"text","text":"shown"}]}}]}\n\ndata: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"detail"}]}}]}\n\ndata: [DONE]\n\n';
    fetchRecovery.mockResolvedValue(response(`id: 1\ndata: ${JSON.stringify(raw)}\n\nevent: done\ndata: {"complete":true}\n\n`));
    await recoverPending();
    expect(state.chats[0].messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'shown' }), expect.objectContaining({ type: 'reasoning', text: 'hiddendetail' }),
    ]));
  });

  it('keeps a window value longer than an old cache-miss snapshot and leaves it pending', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    state.chats[0].messages[0].content = [{ type: 'text', text: 'window-final' }, { type: 'reasoning', text: 'window-thought' }];
    await db.saveRequest({ requestId: 'miss', chatIndex: 0, messageIndex: 0, bufferedText: 'idb', bufferedReasoning: 'idb-thinking-long', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    fetchRecovery.mockImplementation(async () => response('event: cache-miss\ndata: {"complete":false}\n\n'));
    await recoverPending();
    expect(state.chats[0].messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'window-final' }), expect.objectContaining({ type: 'reasoning', text: 'idb-thinking-long' }),
    ]));
    expect(await db.getRequest('miss')).toMatchObject({ acknowledged: true });
    expect(ack).not.toHaveBeenCalled();
  });
});
