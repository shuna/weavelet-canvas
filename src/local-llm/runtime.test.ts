import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalModelRuntime } from './runtime';
import type { ModelFileProvider } from './fileProvider';
import type { LocalModelDefinition } from './types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: Array<Record<string, unknown>> = [];
  terminated = false;

  constructor(..._args: unknown[]) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
    if (message.type === 'init' || message.type === 'load' || message.type === 'unload') {
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
});
