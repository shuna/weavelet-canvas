import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ events: [] as string[], runtime: { stopForAssetRemoval: vi.fn(), endAssetRemoval: vi.fn() } }));
vi.mock('../runtime', () => ({ localModelRuntime: fixture.runtime }));
import { LowbitQConversionManager } from './lowbitQManager';
import { removeAssets } from '../assetRemoval';

class Directory {
  kind = 'directory';
  children = new Map<string, any>();
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<Directory> {
    if (this.children.has(name)) return this.children.get(name);
    if (!opts?.create) throw new DOMException('Missing', 'NotFoundError');
    const child = new Directory(); this.children.set(name, child); return child;
  }
  async removeEntry(name: string) { fixture.events.push('remove'); this.children.delete(name); }
  async *entries() { yield* this.children.entries(); }
}
class ConversionWorker {
  static current: ConversionWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  postMessage = vi.fn();
  terminate = vi.fn(() => { fixture.events.push('terminate'); });
  constructor() { ConversionWorker.current = this; }
}
afterEach(() => vi.unstubAllGlobals());

it('cancels the conversion owner before deleting its target and ignores late worker completion', async () => {
  fixture.events = [];
  fixture.runtime.stopForAssetRemoval.mockResolvedValue('unloaded');
  const root = new Directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  await models.getDirectoryHandle('source--lowbit-q', { create: true });
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  vi.stubGlobal('Worker', ConversionWorker);
  const modelMetadata = new Map();
  const onComplete = vi.fn(result => modelMetadata.set(result.modelDef.id, result.modelDef));
  const manager = new LowbitQConversionManager();
  const conversion = manager.convertFromFile(new File([new Uint8Array([0x47, 0x47, 0x55, 0x46])], 'source.gguf'), 'source', 'Source', { onComplete });
  const rejected = expect(conversion).rejects.toThrow(/キャンセル/);
  const worker = ConversionWorker.current;
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }));
  const lateMessage = worker.onmessage!;
  const removing = removeAssets('source--lowbit-q');
  await rejected;
  await expect(removing).resolves.toMatchObject({ status: 'removed' });
  expect(worker.terminate).toHaveBeenCalled();
  expect(fixture.events.indexOf('terminate')).toBeLessThan(fixture.events.indexOf('remove'));
  expect(models.children.has('source--lowbit-q')).toBe(false);
  lateMessage({ data: { type: 'done', persistedToOpfs: true, originalSize: 4, convertedSize: 4 } } as MessageEvent);
  await Promise.resolve();
  expect(onComplete).not.toHaveBeenCalled();
  expect(modelMetadata.size).toBe(0);
  expect(models.children.has('source--lowbit-q')).toBe(false);
});


it.each(['construction', 'postMessage'])('releases the conversion operation when Worker %s fails', async (failure) => {
  fixture.events = [];
  fixture.runtime.stopForAssetRemoval.mockResolvedValue('unloaded');
  const root = new Directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  await models.getDirectoryHandle('failed--lowbit-q', { create: true });
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  const terminate = vi.fn();
  class FailingWorker {
    onmessage = null;
    onerror = null;
    terminate = terminate;
    constructor() { if (failure === 'construction') throw new Error('startup failed'); }
    postMessage() { throw new Error('startup failed'); }
  }
  vi.stubGlobal('Worker', FailingWorker);
  const manager = new LowbitQConversionManager();
  await expect(manager.convertFromFile(new File(['GGUF'], 'source.gguf'), 'failed', 'Source')).rejects.toThrow('startup failed');
  // Main removal must not remain blocked by the rejected operation's writer token.
  await expect(removeAssets('failed--lowbit-q')).resolves.toMatchObject({ status: 'removed' });
  expect(models.children.has('failed--lowbit-q')).toBe(false);
  if (failure === 'postMessage') expect(terminate).toHaveBeenCalledOnce();
});
