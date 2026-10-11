import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalModelRuntime } from './runtime';
import type { ModelFileProvider } from './fileProvider';
import type { LocalModelDefinition } from './types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static autoRespond = true;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: Array<Record<string, unknown>> = [];
  terminated = false;

  constructor(..._args: unknown[]) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
    if (FakeWorker.autoRespond && (message.type === 'init' || message.type === 'load' || message.type === 'unload')) {
      queueMicrotask(() => this.emit({ id: message.id, type: message.type === 'load' ? 'loaded' : 'ready' }));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: Record<string, unknown>): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const definition: LocalModelDefinition = {
  id: 'test-wllama',
  engine: 'wllama',
  tasks: ['generation'],
  label: 'Test',
  origin: 'test/test',
  source: 'opfs',
  manifest: { kind: 'single-file', entrypoint: 'test.gguf' },
  fileSize: 1,
};

const provider: ModelFileProvider = {
  source: 'opfs',
  isAvailable: async () => true,
  getFile: async () => new Blob(),
  getGgufFiles: async () => [new Blob()],
  getCustomCache: () => ({ match: async () => undefined, put: async () => {} }),
  getFileEntries: async () => [],
  dispose: () => {},
};

describe('LocalModelRuntime request ownership', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.autoRespond = true;
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shares one concurrent load and protects a reservation from normal eviction', async () => {
    const runtime = new LocalModelRuntime();
    await Promise.all([runtime.loadModel(definition, provider), runtime.loadModel(definition, provider)]);

    expect(FakeWorker.instances).toHaveLength(1);
    runtime.reserve('submit:1', [definition.id]);
    expect(await runtime.unloadModel(definition.id)).toBe('reserved');
    expect(await runtime.unloadModel(definition.id, { force: true })).toBe('unloaded');
    expect(runtime.isReserved(definition.id)).toBe(false);
  });

  it('rejects cancellation once and ignores chunks from the aborted generation epoch', async () => {
    const runtime = new LocalModelRuntime();
    await runtime.loadModel(definition, provider);
    const worker = FakeWorker.instances[0];
    const engine = runtime.getWllamaEngine(definition.id)!;
    const chunks: string[] = [];
    const generation = engine.generate({ messages: [{ role: 'user', content: 'test' }] }, {}, (text) => chunks.push(text));
    const request = worker.messages.find((message) => message.type === 'generate')!;

    worker.emit({ id: request.id, type: 'chunk', text: 'before' });
    engine.abort();
    worker.emit({ id: request.id, type: 'chunk', text: 'late' });
    worker.emit({ id: request.id, type: 'done', fullText: 'beforelate' });

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunks).toEqual(['before']);
  });

  it('cancels one owner waiting on a shared load without stopping other owners', async () => {
    FakeWorker.autoRespond = false;
    const runtime = new LocalModelRuntime();
    const initialLoad = runtime.loadModel(definition, provider);
    const ownerA = runtime.ensureLoaded(definition.id, 'owner-a');
    const ownerB = runtime.ensureLoaded(definition.id, 'owner-b');
    const worker = FakeWorker.instances[0];

    runtime.cancelOwner('owner-a');
    await expect(ownerA).rejects.toMatchObject({ name: 'AbortError' });

    const init = worker.messages.find((message) => message.type === 'init')!;
    worker.emit({ id: init.id, type: 'ready' });
    await Promise.resolve();
    const load = worker.messages.find((message) => message.type === 'load')!;
    worker.emit({ id: load.id, type: 'loaded' });

    await Promise.all([initialLoad, ownerB]);
    expect(runtime.isLoaded(definition.id)).toBe(true);
  });

  it('stops a loading worker for asset removal and rejects later reload attempts', async () => {
    FakeWorker.autoRespond = false;
    const runtime = new LocalModelRuntime();
    const loading = runtime.loadModel(definition, provider);
    const waitingOwner = runtime.ensureLoaded(definition.id, 'delete-owner');
    const worker = FakeWorker.instances[0];
    const loadingRejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    const ownerRejected = expect(waitingOwner).rejects.toMatchObject({ name: 'AbortError' });

    expect(await runtime.stopForAssetRemoval(definition.id)).toBe('unloaded');
    await Promise.all([loadingRejected, ownerRejected]);
    await expect(runtime.ensureLoaded(definition.id, 'new-owner')).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });
});
