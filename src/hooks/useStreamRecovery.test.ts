import { beforeEach, expect, it, vi } from 'vitest';
import type { StoreState } from '@store/store';
import type { ChatInterface } from '@type/chat';
import type { ContentStoreData } from '@utils/contentStore';
import type { StreamRecord } from '@utils/streamDb';

const fixture = vi.hoisted(() => ({
  state: {} as StoreState,
  records: [] as StreamRecord[],
  remove: vi.fn(), save: vi.fn(), proxy: vi.fn(), ack: vi.fn(),
}));
vi.mock('@store/store', () => ({ default: {
  getState: () => fixture.state,
  setState: (update: (state: StoreState) => Partial<StoreState>) => { Object.assign(fixture.state, update(fixture.state)); },
  persist: { hasHydrated: () => true },
} }));
vi.mock('@utils/streamDb', () => ({
  getAllPending: async () => fixture.records,
  cleanupStale: vi.fn(),
  deleteRequest: (...args: unknown[]) => fixture.remove(...args),
  saveRequest: (...args: unknown[]) => fixture.save(...args),
  saveRecoveryRecord: (record: StreamRecord) => fixture.save(record),
  saveProxyCheckpoint: vi.fn(),
}));
vi.mock('@utils/swBridge', () => ({ register: vi.fn() }));
vi.mock('@utils/proxyClient', () => ({
  fetchProxyRecovery: (...args: unknown[]) => fixture.proxy(...args),
  sendAck: (...args: unknown[]) => fixture.ack(...args),
  parseProxySse: () => ({ partial: '', events: [
    { rawText: 'data: {"choices":[{"delta":{"content":"recovered response"}}]}\n\ndata: [DONE]\n\n' },
    { eventType: 'done', meta: { complete: true } },
  ] }),
}));
vi.mock('@store/debug-store', () => ({ debugReport: vi.fn() }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@utils/openrouterObservation', () => ({ recordOpenRouterObservation: vi.fn() }));

import { addContent, resolveContent } from '@utils/contentStore';
import { recoverPending } from './useStreamRecovery';
import { invalidateAiTasks } from './aiTaskLifetime';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAiTasks();
  const contentStore = {};
  const hash = addContent(contentStore, [{ type: 'text', text: '' }]);
  const chat = { id: 'original', config: {}, messages: [{ role: 'assistant', content: [{ type: 'text', text: '' }] }], branchTree: {
    rootId: 'node', activePath: ['node'], nodes: { node: { id: 'node', role: 'assistant', parentId: null, createdAt: 1, contentHash: hash } },
  } };
  fixture.state = {
    chats: [chat], contentStore, generatingSessions: {}, proxyEnabled: false,
    proxyEndpoint: 'https://proxy.test', proxyAuthToken: '',
    invalidateBranchHistory: vi.fn(),
    applyBranchState: (chats: ChatInterface[], store: ContentStoreData) => { fixture.state.chats = chats; fixture.state.contentStore = store; },
  } as unknown as StoreState;
  fixture.records = [{ requestId: 'request', chatId: 'original', nodeId: 'node', checkpointHash: hash, checkpointRole: 'assistant',
    chatIndex: 0, messageIndex: 0, bufferedText: '', status: 'interrupted', createdAt: Date.now(), updatedAt: 1, acknowledged: false }];
  fixture.save.mockResolvedValue(undefined);
  fixture.remove.mockResolvedValue(undefined);
});
const stream = () => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('proxy data')); controller.close();
} }));
const text = (index: number) => resolveContent(fixture.state.contentStore, fixture.state.chats![index].branchTree!.nodes.node.contentHash);

it('retains legacy index-only records and checkpoint conflicts without applying or deleting', async () => {
  fixture.records.push({ ...fixture.records[0], requestId: 'legacy', chatId: undefined, nodeId: undefined });
  fixture.records[0].checkpointHash = 'other';
  fixture.records[0].bufferedText = 'wrong target';
  await recoverPending();
  expect(text(0)).toEqual([{ type: 'text', text: '' }]);
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(fixture.save).not.toHaveBeenCalled();
});

it('recovers SW text without proxy and retains it until the primary snapshot acknowledges its applied hash', async () => {
  fixture.records[0].bufferedText = 'background response';
  const clone = { ...structuredClone(fixture.state.chats![0]), id: 'clone' };
  fixture.state.chats!.unshift(clone);
  await recoverPending();
  expect(text(0)).toEqual([{ type: 'text', text: '' }]);
  expect(text(1)).toEqual([{ type: 'text', text: 'background response' }]);
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ appliedHash: fixture.state.chats![1].branchTree!.nodes.node.contentHash }));
});

it.each(['edit', 'role', 'invalidate'] as const)('rejects proxy output after %s while awaiting it', async (change) => {
  fixture.state.proxyEnabled = true;
  fixture.records[0].proxySessionId = 'proxy-request';
  let resolve!: (value: Response) => void;
  fixture.proxy.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  const pending = recoverPending();
  await vi.waitFor(() => expect(fixture.proxy).toHaveBeenCalledTimes(1));
  if (change === 'edit') {
    const hash = addContent(fixture.state.contentStore, [{ type: 'text', text: 'user edit' }]);
    fixture.state.chats![0].branchTree!.nodes.node.contentHash = hash;
  } else if (change === 'role') {
    fixture.state.chats![0].branchTree!.nodes.node.role = 'user';
  } else {
    invalidateAiTasks(['original'], ['node']);
    expect(fixture.proxy.mock.calls[0][3].aborted).toBe(true);
  }
  resolve(stream());
  await pending;
  expect(text(0)).toEqual([{ type: 'text', text: change === 'edit' ? 'user edit' : '' }]);
  expect(fixture.save).not.toHaveBeenCalled();
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(fixture.ack).not.toHaveBeenCalled();
});

it('rechecks the chat identity after proxy await even when the chat order changes', async () => {
  fixture.state.proxyEnabled = true;
  fixture.records[0].proxySessionId = 'proxy-request';
  let resolve!: (value: Response) => void;
  fixture.proxy.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  const pending = recoverPending();
  await vi.waitFor(() => expect(fixture.proxy).toHaveBeenCalledTimes(1));
  fixture.state.chats!.unshift({ ...structuredClone(fixture.state.chats![0]), id: 'clone' });
  resolve(stream());
  await pending;
  expect(text(0)).toEqual([{ type: 'text', text: '' }]);
  expect(text(1)).toEqual([{ type: 'text', text: 'recovered response' }]);
  expect(fixture.ack).not.toHaveBeenCalled();
});
