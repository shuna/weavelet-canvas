import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  stopForAssetRemoval: vi.fn<() => Promise<'unloaded' | 'blocked'>>(),
  endAssetRemoval: vi.fn(),
}));

vi.mock('./runtime', () => ({ localModelRuntime: runtime }));

import {
  beginWrite,
  finishWrite,
  openDownloadWriter,
  registerWriterAbort,
  saveFile,
} from './storage';
import { removeAssets } from './assetRemoval';
import type { LocalModelManifest } from './types';

class Deferred {
  promise: Promise<void>;
  resolve!: () => void;
  constructor() {
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }
}

class FakeFileHandle {
  readonly kind = 'file';
  bytes = new Uint8Array();
  constructor(private readonly abortGate: () => Deferred | undefined) {}

  async getFile(): Promise<File> {
    return new Blob([this.bytes]) as File;
  }

  async createWritable(options?: { keepExistingData?: boolean }) {
    let bytes = options?.keepExistingData ? this.bytes.slice() : new Uint8Array();
    let position = bytes.length;
    const append = (input: Uint8Array) => {
      const end = position + input.length;
      if (end > bytes.length) {
        const next = new Uint8Array(end);
        next.set(bytes);
        bytes = next;
      }
      bytes.set(input, position);
      position = end;
    };
    return {
      write: async (data: Uint8Array | ArrayBuffer | Blob | string) => {
        if (data instanceof Blob) append(new Uint8Array(await data.arrayBuffer()));
        else if (typeof data === 'string') append(new TextEncoder().encode(data));
        else append(new Uint8Array(data));
      },
      seek: async (offset: number) => { position = offset; },
      truncate: async (size: number) => { bytes = bytes.slice(0, size); },
      close: async () => { this.bytes = bytes; },
      abort: async () => { await this.abortGate()?.promise; },
    };
  }
}

class FakeDirectory {
  readonly kind = 'directory';
  entriesMap = new Map<string, FakeDirectory | FakeFileHandle>();
  failRemove = new Set<string>();
  constructor(private readonly abortGate: () => Deferred | undefined) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    const existing = this.entriesMap.get(name);
    if (existing instanceof FakeDirectory) return existing;
    if (!options?.create) throw new Error('missing directory');
    const dir = new FakeDirectory(this.abortGate);
    this.entriesMap.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.entriesMap.get(name);
    if (existing instanceof FakeFileHandle) return existing;
    if (!options?.create) throw new Error('missing file');
    const file = new FakeFileHandle(this.abortGate);
    this.entriesMap.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (this.failRemove.has(name)) throw new DOMException('locked', 'NoModificationAllowedError');
    if (!this.entriesMap.delete(name)) throw new Error('missing entry');
  }

  async *entries(): AsyncGenerator<[string, FakeDirectory | FakeFileHandle]> {
    for (const entry of this.entriesMap.entries()) yield entry;
  }
}

describe('OPFS writer and asset removal', () => {
  let root: FakeDirectory;
  let abortGate: Deferred | undefined;

  beforeEach(() => {
    abortGate = undefined;
    root = new FakeDirectory(() => abortGate);
    runtime.stopForAssetRemoval.mockReset();
    runtime.stopForAssetRemoval.mockResolvedValue('unloaded');
    runtime.endAssetRemoval.mockReset();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('waits for an active writer abort before deleting assets and rejects new writers', async () => {
    abortGate = new Deferred();
    const writer = await openDownloadWriter('model-a', 'weights.gguf', 0);
    await writer.write(new Uint8Array([1, 2, 3]));

    const removal = removeAssets('model-a');
    await Promise.resolve();
    const models = await root.getDirectoryHandle('models');
    expect(models.entriesMap.has('model-a')).toBe(true);
    expect(() => beginWrite('model-a')).toThrow(/being removed/);

    abortGate.resolve();
    await expect(removal).resolves.toMatchObject({ status: 'removed' });
    expect(models.entriesMap.has('model-a')).toBe(false);
  });

  it('keeps files when a writer cannot stop', async () => {
    await saveFile('model-b', 'weights.gguf', new Blob([new Uint8Array([1, 2, 3])]));
    const token = beginWrite('model-b');
    registerWriterAbort(token, async () => { throw new Error('writer still owns file'); });

    await expect(removeAssets('model-b')).resolves.toMatchObject({ status: 'blocked' });
    const models = await root.getDirectoryHandle('models');
    expect(models.entriesMap.has('model-b')).toBe(true);
    finishWrite(token, 'failed');
  });

  it('reports partial verification after removing one shard', async () => {
    const manifest: LocalModelManifest = {
      kind: 'gguf-sharded', entrypoint: 'part-1.gguf', shards: ['part-1.gguf', 'part-2.gguf'], totalSize: 8,
    };
    await saveFile('model-c', 'part-1.gguf', new Blob([new Uint8Array([0x47, 0x47, 0x55, 0x46]) ]));
    await saveFile('model-c', 'part-2.gguf', new Blob([new Uint8Array([1, 2, 3, 4]) ]));

    await expect(removeAssets('model-c', { files: ['part-2.gguf'], manifest }))
      .resolves.toMatchObject({ status: 'removed', verification: 'partial', retainedFiles: ['part-1.gguf'] });
  });

  it('removes independent lowbit source and target without cross-model writer blocking', async () => {
    await saveFile('source', 'source.gguf', new Blob([new Uint8Array([1]) ]));
    await saveFile('target', 'target.gguf', new Blob([new Uint8Array([2]) ]));

    const results = await Promise.all([removeAssets('source'), removeAssets('target')]);
    expect(results.map((result) => result.status)).toEqual(['removed', 'removed']);
  });

  it('returns independent outcomes for a bulk caller so only removed models can clear metadata', async () => {
    await saveFile('bulk-good', 'weights.gguf', new Blob([new Uint8Array([1]) ]));
    await saveFile('bulk-blocked', 'weights.gguf', new Blob([new Uint8Array([2]) ]));
    const token = beginWrite('bulk-blocked');
    registerWriterAbort(token, async () => { throw new Error('cannot stop'); });

    const results = await Promise.all([removeAssets('bulk-good'), removeAssets('bulk-blocked')]);
    expect(results.map((result) => result.status)).toEqual(['removed', 'blocked']);
    const models = await root.getDirectoryHandle('models');
    expect(models.entriesMap.has('bulk-good')).toBe(false);
    expect(models.entriesMap.has('bulk-blocked')).toBe(true);
    finishWrite(token, 'failed');
  });

  it('does not treat a non-NotFound file deletion error as successful removal', async () => {
    await expect(removeAssets('delete-error', { files: ['missing.gguf'] }))
      .resolves.toMatchObject({ status: 'failed' });
  });

  it('reports files already removed when a later file deletion fails', async () => {
    await saveFile('multi', 'first.gguf', new Blob([new Uint8Array([1]) ]));
    await saveFile('multi', 'locked.gguf', new Blob([new Uint8Array([2]) ]));
    const models = await root.getDirectoryHandle('models');
    const dir = await models.getDirectoryHandle('multi');
    dir.failRemove.add('locked.gguf');

    await expect(removeAssets('multi', { files: ['first.gguf', 'locked.gguf'] }))
      .resolves.toMatchObject({ status: 'partial', removedFiles: ['first.gguf'], retainedFiles: ['locked.gguf'] });
  });
  it('retains the incomplete marker if deleting its body fails', async () => {
    await saveFile('incomplete', 'weights.gguf', new Blob([new Uint8Array([1])]));
    await saveFile('incomplete', 'weights.gguf.part', new Blob([]));
    const models = await root.getDirectoryHandle('models');
    const dir = await models.getDirectoryHandle('incomplete');
    dir.failRemove.add('weights.gguf');
    await expect(removeAssets('incomplete', { files: ['weights.gguf', 'weights.gguf.part'] }))
      .resolves.toMatchObject({ status: 'failed', removedFiles: [] });
    expect(dir.entriesMap.has('weights.gguf.part')).toBe(true);
  });

});
