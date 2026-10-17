import { afterEach, expect, it, vi } from 'vitest';
import { digest, encode } from './crypto';
import { useGoogleSyncProgress, withSyncProgress } from './progress';
import { toRecords, type Snapshot } from './records';
import type { ChatInterface, ContentInterface } from '@type/chat';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: any[] = [];
  terminated = false;
  constructor(..._args: any[]) { FakeWorker.instances.push(this); }
  postMessage(message: any) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(message: any) { this.onmessage?.({ data: message } as MessageEvent); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); FakeWorker.instances = []; });

it('forwards intermediate history progress without resolving or removing the pending request', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const processing = await import('./processing');
  await withSyncProgress(async () => {
    const task = processing.replayHistoryAsync({ commits: {}, tips: [] });
    const worker = FakeWorker.instances[0];
    const id = worker.messages[0].id;
    worker.reply({ id, progress: { step: 'replaying', completed: 1, total: 2 } });
    expect(useGoogleSyncProgress.getState().historyProgress).toEqual({ step: 'replaying', completed: 1, total: 2 });
    worker.reply({ id, value: { records: {}, conflicts: {} }, metrics: {} });
    await expect(task).resolves.toEqual({ records: {}, conflicts: {} });
    worker.reply({ id, progress: { step: 'replaying', completed: 2, total: 2 } });
    expect(useGoogleSyncProgress.getState().historyProgress?.completed).toBe(1);
  });
});

it('emits progress before the final result from the actual worker handler', async () => {
  const scope: any = { postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./processing.worker');
  scope.onmessage({ data: { id: 7, operation: 'replayHistory', value: {
    commits: { a: { version: 1, parents: [], changes: [] } }, tips: ['a'],
  } } });
  await vi.waitFor(() => expect(scope.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ id: 7, value: { records: {}, conflicts: {} } }));
  const replies = scope.postMessage.mock.calls.map(([message]: any[]) => message);
  expect(replies[0]).toEqual({ id: 7, progress: { step: 'scanning', completed: 0 } });
  expect(replies.some((message: any) => message.progress?.step === 'replaying')).toBe(true);
});

it('reuses one worker, keeps inputs owned by the caller, and matches commit digests', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const processing = await import('./processing');
  const bytes = new Uint8Array([1, 2]);
  const one = processing.decodeAsync<any>(bytes);
  const two = processing.decodeAsync<any>(bytes);
  const worker = FakeWorker.instances[0];
  expect(FakeWorker.instances).toHaveLength(1);
  expect(worker.messages.map(message => message.id)).toEqual([0, 1]);
  expect(bytes).toEqual(new Uint8Array([1, 2]));
  worker.reply({ id: 1, value: 'second', metrics: {} });
  worker.reply({ id: 0, value: 'first', metrics: {} });
  await expect(one).resolves.toBe('first');
  await expect(two).resolves.toBe('second');
  const commits = { a: { version: 1 as const, parents: [], changes: [] } };
  const hash = processing.hashCommitsAsync(commits);
  worker.reply({ id: 2, value: { a: await digest(encode(commits.a)) }, metrics: {} });
  await expect(hash).resolves.toEqual({ a: await digest(encode(commits.a)) });
});

it('rejects all pending requests after a worker failure and creates a replacement', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const processing = await import('./processing');
  const first = processing.decodeAsync<any>(new Uint8Array([1]));
  const second = processing.decodeAsync<any>(new Uint8Array([2]));
  FakeWorker.instances[0].onerror?.();
  await expect(first).rejects.toThrow('Unable to process');
  await expect(second).rejects.toThrow('Unable to process');
  const next = processing.decodeAsync<any>(new Uint8Array([3]));
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].reply({ id: 2, value: 'ok', metrics: {} });
  await expect(next).resolves.toBe('ok');
  FakeWorker.instances[0].onerror?.();
  const afterOldFailure = processing.decodeAsync<any>(new Uint8Array([4]));
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].reply({ id: 3, value: 'still running', metrics: {} });
  await expect(afterOldFailure).resolves.toBe('still running');
});

it('continues after a regular worker error and merges each response metrics once', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const processing = await import('./processing');
  const metrics = await import('./metrics');
  metrics.resetSyncMetrics();
  const failed = processing.decodeAsync<any>(new Uint8Array([0]));
  const continued = processing.decodeAsync<any>(new Uint8Array([1]));
  const worker = FakeWorker.instances[0];
  worker.reply({ id: 0, error: 'bad data', metrics: { serialize: { calls: 1, ms: 1, inputBytes: 2, outputBytes: 3 } } });
  worker.reply({ id: 1, value: 'ok', metrics: { serialize: { calls: 1, ms: 2, inputBytes: 4, outputBytes: 5 } } });
  await expect(failed).rejects.toThrow('bad data');
  await expect(continued).resolves.toBe('ok');
  expect(FakeWorker.instances).toHaveLength(1);
  expect(metrics.getSyncMetrics().serialize).toEqual({ calls: 2, ms: 3, inputBytes: 6, outputBytes: 8 });
});

it('matches direct commit hashing without a worker', async () => {
  vi.stubGlobal('Worker', undefined);
  const [{ hashCommitsAsync }, { hashCommits }] = await Promise.all([import('./processing'), import('./replay')]);
  const commits = Object.fromEntries(Array.from({ length: 128 }, (_, index) => [`${index}`, {
    version: 1 as const, parents: [], changes: [{ key: 'key', before: null, after: String(index) }],
  }]));
  await expect(hashCommitsAsync(commits)).resolves.toEqual(await hashCommits(commits));
});

it('resets worker metrics and runs worker requests in order', async () => {
  const scope: any = { postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./processing.worker');
  scope.onmessage({ data: { id: 1, operation: 'hashCommits', value: { a: { version: 1, parents: [], changes: [] } } } });
  scope.onmessage({ data: { id: 2, operation: 'encode', value: { second: true } } });
  scope.onmessage({ data: { id: 3, operation: 'encode', value: { third: true } } });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(3));
  const replies = scope.postMessage.mock.calls.map(([message]: any[]) => message);
  expect(replies.map((message: any) => message.id)).toEqual([1, 2, 3]);
  expect(replies[2].metrics.serialize.calls).toBe(1);
});

it('passes trusted complete wire bytes through the worker adapter without encoding them again', async () => {
  const scope: any = { postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./processing.worker');
  const value = { version: 1 as const, parents: [], changes: [] };
  const full = encode(value);
  scope.onmessage({ data: { id: 12, operation: 'encodeWire', value: { value, full } } });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(1));
  const reply = scope.postMessage.mock.calls[0][0];
  expect(reply.id).toBe(12);
  expect(reply.value).toEqual(full);
  expect(reply.metrics.serialize).toBeUndefined();
});


it('omits only derived tree messages before worker transfer and preserves records, legacy messages and source snapshots', async () => {
  const content: ContentInterface[] = [{ type: 'text', text: 'synthetic body' }];
  const treeChat: ChatInterface = {
    id: 'tree', title: 'fixture', titleSet: true, imageDetail: 'auto',
    config: { model: 'test', max_tokens: 1, temperature: 1, presence_penalty: 0, frequency_penalty: 0, top_p: 1 },
    messages: [{ role: 'user', content }],
    branchTree: { rootId: 'node', activePath: ['node'], nodes: {
      node: { id: 'node', parentId: null, role: 'user', contentHash: 'body', createdAt: 1 },
    } },
  };
  const legacyChat = { ...treeChat, id: 'legacy', branchTree: undefined };
  const original: Snapshot = { version: 18, state: { chats: [treeChat, legacyChat],
    contentStore: { body: { content, refCount: 1 } }, defaultSystemMessage: 'retained metadata',
    pendingVerifications: {}, verifiedStats: {},
  } };
  const before = structuredClone(original), expected = await toRecords(original);
  vi.stubGlobal('Worker', FakeWorker);
  const processing = await import('./processing');
  const result = processing.toRecordsAsync(original);
  const worker = FakeWorker.instances[0], request = worker.messages[0];
  expect(request.value.state.chats[0].messages).toEqual([]);
  expect(request.value.state.chats[0].branchTree).toBe(treeChat.branchTree);
  expect(request.value.state.chats[1]).toBe(legacyChat);
  expect(request.value.state.contentStore).toBe(original.state.contentStore);
  expect(request.value.state.pendingVerifications).toBe(original.state.pendingVerifications);
  expect(request.value.state.verifiedStats).toBe(original.state.verifiedStats);
  expect(request.value.state.defaultSystemMessage).toBe(original.state.defaultSystemMessage);
  expect(await toRecords(request.value)).toEqual(expected);
  worker.reply({ id: request.id, value: expected, metrics: {} });
  await expect(result).resolves.toEqual(expected);
  const comparison = processing.sameSnapshotAsync(original, original);
  const comparisonRequest = worker.messages[1];
  for (const value of comparisonRequest.value) {
    expect(value.state.chats[0].messages).toEqual([]);
    expect(value.state.chats[1].messages).toBe(legacyChat.messages);
  }
  worker.reply({ id: comparisonRequest.id, value: true, metrics: {} });
  await expect(comparison).resolves.toBe(true);
  vi.stubGlobal('Worker', undefined);
  await expect(processing.toRecordsAsync(original)).resolves.toEqual(expected);
  await expect(processing.sameSnapshotAsync(original, original)).resolves.toBe(true);
  expect(original).toEqual(before);
});
