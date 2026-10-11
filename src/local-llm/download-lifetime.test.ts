import { afterEach, expect, it, vi } from 'vitest';
import type { DownloadCallbacks } from './download';

const fixture = vi.hoisted(() => ({
  state: {} as any,
  events: [] as string[],
  runtime: { stopForAssetRemoval: vi.fn(), endAssetRemoval: vi.fn() },
}));
vi.mock('./runtime', () => ({ localModelRuntime: fixture.runtime }));
vi.mock('@store/store', () => ({ default: { getState: () => fixture.state } }));
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, vi.fn()] }));

import { useModelDownload } from '@hooks/useModelDownload';
import { downloadModelFiles } from './download';
import { removeAssets } from './assetRemoval';
import { beginWrite } from './storage';

class Directory {
  kind = 'directory';
  children = new Map<string, any>();
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<Directory> {
    if (this.children.has(name)) return this.children.get(name);
    if (!opts?.create) throw new DOMException('Missing', 'NotFoundError');
    const child = new Directory();
    this.children.set(name, child);
    return child;
  }
  async getFileHandle() { throw new DOMException('Missing', 'NotFoundError'); }
  async removeEntry(name: string) {
    if (!this.children.has(name)) throw new DOMException('Missing', 'NotFoundError');
    fixture.events.push('remove'); this.children.delete(name);
  }
  async *entries() { yield* this.children.entries(); }
}

afterEach(() => vi.unstubAllGlobals());

it('waits for the pre-writer download to stop and rejects callbacks arriving after asset removal', async () => {
  const root = new Directory();
  const models = await root.getDirectoryHandle('models', { create: true });
  await models.getDirectoryHandle('download-target', { create: true });
  fixture.events = [];
  fixture.runtime.stopForAssetRemoval.mockResolvedValue('unloaded');
  fixture.state = { savedModelMeta: {}, updateSavedModelMeta: vi.fn((id, patch) => {
    fixture.state.savedModelMeta[id] = { ...fixture.state.savedModelMeta[id], ...patch };
  }) };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  let resolveFetch!: (response: Response) => void;
  let resolveStarted!: () => void;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url, options) => {
    signal = options.signal;
    signal.addEventListener('abort', () => fixture.events.push('abort'), { once: true });
    resolveStarted();
    // Deliberately resolve late instead of honoring abort, like an already queued response.
    return new Promise<Response>(resolve => { resolveFetch = resolve; });
  }));
  const complete = vi.fn();
  let callbacks!: DownloadCallbacks;
  let download!: Promise<void>;
  useModelDownload().startDownload('download-target', (cb, abortSignal) => {
    callbacks = cb;
    download = downloadModelFiles({ modelId: 'download-target', repo: 'test/model', revision: 'main', files: ['weights.gguf'] }, cb, abortSignal);
  }, { onComplete: complete });
  await started;
  const removing = removeAssets('download-target');
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  expect(models.children.has('download-target')).toBe(true);
  expect(() => beginWrite('download-target')).toThrow(/being removed/);
  resolveFetch(new Response(new Uint8Array([0x47, 0x47, 0x55, 0x46]), { headers: { 'content-length': '4' } }));
  await download;
  await expect(removing).resolves.toMatchObject({ status: 'removed' });
  expect(fixture.events).toEqual(['abort', 'remove']);
  expect(models.children.has('download-target')).toBe(false);
  delete fixture.state.savedModelMeta['download-target']; // UI removes metadata only after removeAssets completes.
  callbacks.onFileComplete('weights.gguf', 4);
  callbacks.onComplete(4);
  expect(fixture.state.savedModelMeta['download-target']).toBeUndefined();
  expect(complete).not.toHaveBeenCalled();
});
