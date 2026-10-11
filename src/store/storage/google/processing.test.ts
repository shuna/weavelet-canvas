import { afterEach, expect, it, vi } from 'vitest';
import { digest, encode } from './crypto';

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
