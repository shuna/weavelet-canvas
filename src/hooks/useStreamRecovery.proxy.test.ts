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
vi.mock('@store/debug-store', () => ({ debugReport: vi.fn() }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@store/stream-end-status-store', () => ({ useStreamEndStatusStore: { getState: () => ({ setStatus: vi.fn() }) } }));
vi.mock('@utils/openrouterVerification', () => ({ buildVerifiedStatsKey: () => '', OPENROUTER_VERIFICATION_INITIAL_DELAY_MS: 0 }));

const response = (text: string, status = 200) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status });
import { addContent } from '@utils/contentStore';

const chat = () => ({ id: 'c', config: {}, messages: [{ role: 'assistant', content: [{ type: 'text', text: '' }] }], branchTree: { rootId: 'n', activePath: ['n'], nodes: { n: { id: 'n', role: 'assistant', parentId: null, createdAt: 1, contentHash: '' } } } });

describe('recoverPending proxy outcomes', () => {
  beforeEach(async () => {
    (globalThis as any).indexedDB = new IDBFactory(); (globalThis as any).IDBKeyRange = IDBKeyRange;
    state = { proxyEnabled: true, proxyEndpoint: 'https://proxy', proxyAuthToken: '', chats: [chat()], generatingSessions: {}, contentStore: {},
      setChats: (chats: any) => { state.chats = chats; }, removeSessionsForChat: vi.fn(), queueVerification: vi.fn() };
    state.chats[0].branchTree.nodes.n.contentHash = addContent(state.contentStore, state.chats[0].messages[0].content);
    state.invalidateBranchHistory = vi.fn();
    state.applyBranchState = (chats: any, store: any) => { state.chats = chats; state.contentStore = store; };
    ack.mockClear(); fetchRecovery.mockReset();
  });

  it('keeps pending data on recovery network failure', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ chatId: 'c', nodeId: 'n', checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, checkpointRole: 'assistant', requestId: 'n', chatIndex: 0, messageIndex: 0, bufferedText: 'local', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    fetchRecovery.mockRejectedValue(new Error('offline'));
    await recoverPending();
    expect(await db.getRequest('n')).toMatchObject({ acknowledged: false, bufferedText: 'local' });
    expect(ack).not.toHaveBeenCalled();
  });

  it('restores split think content and defers deletion until the primary snapshot commits', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ chatId: 'c', nodeId: 'n', checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, checkpointRole: 'assistant', requestId: 'ok', chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0, llmSsePartial: '', thinkTagCheckpoint: { state: 'outside', pending: '' } });
    const raw = 'data: {"choices":[{"delta":{"content":"<think>x</think>y"}}]}\n\ndata: [DONE]\n\n';
    fetchRecovery.mockResolvedValue(response(`id: 1\ndata: ${JSON.stringify(raw)}\n\nevent: done\ndata: {"complete":true}\n\n`));
    await recoverPending();
    expect(state.chats[0].messages[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'y' }), expect.objectContaining({ type: 'reasoning', text: 'x' })]));
    expect(ack).not.toHaveBeenCalled();
    expect(await db.getRequest('ok')).toMatchObject({ proxyComplete: true, appliedHash: state.chats[0].branchTree.nodes.n.contentHash });
    expect(await db.updateStreamCheckpoints({ chats: state.chats }, [])).toHaveLength(1);
    expect(await db.getRequest('ok')).toBeUndefined();
  });

  it('restores content blocks and reasoning_details with the normal extraction rules', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ chatId: 'c', nodeId: 'n', checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, checkpointRole: 'assistant', requestId: 'blocks', chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
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
    state.chats[0].branchTree.nodes.n.contentHash = addContent(state.contentStore, state.chats[0].messages[0].content);
    await db.saveRequest({ chatId: 'c', nodeId: 'n', checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, checkpointRole: 'assistant', requestId: 'miss', chatIndex: 0, messageIndex: 0, bufferedText: 'idb', bufferedReasoning: 'idb-thinking-long', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    fetchRecovery.mockImplementation(async () => response('event: cache-miss\ndata: {"complete":false}\n\n'));
    await recoverPending();
    expect(state.chats[0].messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'window-final' }), expect.objectContaining({ type: 'reasoning', text: 'idb-thinking-long' }),
    ]));
    expect(await db.getRequest('miss')).toMatchObject({ acknowledged: false });
    expect(await db.updateStreamCheckpoints({ chats: state.chats }, [])).toEqual([]);
    expect(await db.getRequest('miss')).toMatchObject({ checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, appliedHash: undefined });
    expect(ack).not.toHaveBeenCalled();
  });
  it('resumes from the persisted event cursor and split think state without duplicating output', async () => {
    const db = await import('@utils/streamDb'); const { recoverPending } = await import('./useStreamRecovery');
    await db.saveRequest({ chatId: 'c', nodeId: 'n', checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, checkpointRole: 'assistant', requestId: 'resume', chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'streaming', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    const first = 'data: {"choices":[{"delta":{"content":"<think>first"}}]}\n\n';
    fetchRecovery.mockResolvedValueOnce(response(`id: 1\ndata: ${JSON.stringify(first)}\n\nevent: interrupted\ndata: {}\n\n`));
    await recoverPending();
    expect(await db.getRequest('resume')).toMatchObject({ lastProxyEventId: 1, bufferedReasoning: 'first', status: 'interrupted', proxyComplete: false });
    expect(await db.updateStreamCheckpoints({ chats: state.chats }, [])).toEqual([]);
    const second = 'data: {"choices":[{"delta":{"content":" second</think>answer"}}]}\n\ndata: [DONE]\n\n';
    fetchRecovery.mockResolvedValueOnce(response(`id: 2\ndata: ${JSON.stringify(second)}\n\nevent: done\ndata: {"complete":true}\n\n`));
    await recoverPending();
    expect(fetchRecovery.mock.calls[1][2]).toBe(1);
    expect(state.chats[0].messages[0].content).toEqual([{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'first second' }]);
    expect(ack).not.toHaveBeenCalled();
    expect(await db.updateStreamCheckpoints({ chats: state.chats }, [])).toHaveLength(1);
  });

  it.each([false, true])('does not restore cancelled output or recreate a pending record (purge=%s)', async (purge) => {
    const db = await import('@utils/streamDb');
    const { recoverPending, cancelActiveRecovery, cancelAndPurgeRecovery } = await import('./useStreamRecovery');
    await db.saveRequest({ chatId: 'c', nodeId: 'n', checkpointHash: state.chats[0].branchTree.nodes.n.contentHash, checkpointRole: 'assistant', requestId: 'cancel', chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'failed', createdAt: 1, updatedAt: 1, acknowledged: false, proxySessionId: 's', lastProxyEventId: 0 });
    let reader!: ReadableStreamDefaultController<Uint8Array>;
    fetchRecovery.mockResolvedValue(new Response(new ReadableStream({ start(controller) { reader = controller; } })));
    const pending = recoverPending();
    await vi.waitFor(() => expect(fetchRecovery).toHaveBeenCalledOnce());
    if (purge) await cancelAndPurgeRecovery(true);
    else cancelActiveRecovery(true);
    const raw = 'data: {"choices":[{"delta":{"content":"late answer"}}]}\n\ndata: [DONE]\n\n';
    reader.enqueue(new TextEncoder().encode(`id: 1\ndata: ${JSON.stringify(raw)}\n\nevent: done\ndata: {"complete":true}\n\n`));
    reader.close();
    await pending;
    if (purge) expect(await db.getRequest('cancel')).toBeUndefined();
    else expect(await db.getRequest('cancel')).toMatchObject({ bufferedText: '', lastProxyEventId: 0 });
    expect(state.chats[0].messages[0].content).toEqual([{ type: 'text', text: '' }]);
    expect(ack).not.toHaveBeenCalled();
  });

});
