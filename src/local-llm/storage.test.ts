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
  readFile, listFiles, getStoredSize, listSavedModelIds, getOPFSFileSize, hasTempFile, getTempFileSize,
  commitTempFile, removeTempFile, writeTempChunk, deleteModelFile, listAllOpfsEntries, getTotalStorageUsed,
  verifyStoredModel, OpfsFileProvider, createOPFSSyncWriter,
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
  failClose = false;
  constructor(private readonly abortGate: () => Deferred | undefined) {}

  async getFile(): Promise<File> {
    return new Blob([this.bytes]) as File;
  }
  async createSyncAccessHandle() {
    return {
      truncate: (size: number) => { this.bytes = this.bytes.slice(0, size); },
      write: (data: Uint8Array, { at }: { at: number }) => {
        const next = new Uint8Array(Math.max(this.bytes.length, at + data.length));
        next.set(this.bytes); next.set(data, at); this.bytes = next;
        return data.length;
      },
      flush: () => {}, close: () => {},
    };
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
      close: async () => { if (this.failClose) throw new DOMException('write failed', 'NoModificationAllowedError'); this.bytes = bytes; },
      abort: async () => { await this.abortGate()?.promise; },
    };
  }
}

const validName = (name: string) => {
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new TypeError('Invalid file name');
};

class FakeDirectory {
  readonly kind = 'directory';
  entriesMap = new Map<string, FakeDirectory | FakeFileHandle>();
  failRemove = new Set<string>();
  constructor(private readonly abortGate: () => Deferred | undefined) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    validName(name);
    const existing = this.entriesMap.get(name);
    if (existing instanceof FakeDirectory) return existing;
    if (existing) throw new DOMException('File at directory path', 'TypeMismatchError');
    if (!options?.create) throw new DOMException('missing directory', 'NotFoundError');
    const dir = new FakeDirectory(this.abortGate);
    this.entriesMap.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    validName(name);
    const existing = this.entriesMap.get(name);
    if (existing instanceof FakeFileHandle) return existing;
    if (existing) throw new DOMException('Directory at file path', 'TypeMismatchError');
    if (!options?.create) throw new DOMException('missing file', 'NotFoundError');
    const file = new FakeFileHandle(this.abortGate);
    this.entriesMap.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    validName(name);
    if (this.failRemove.has(name)) throw new DOMException('locked', 'NoModificationAllowedError');
    if (!this.entriesMap.delete(name)) throw new DOMException('missing entry', 'NotFoundError');
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

  it('writes nested manifest files through directory handles', async () => {
    await saveFile('nested-model', 'onnx/model_quantized.onnx', new Blob(['model']));
    const models = await root.getDirectoryHandle('models');
    const dir = await models.getDirectoryHandle('nested-model');
    expect((await (await (await dir.getDirectoryHandle('onnx')).getFileHandle('model_quantized.onnx')).getFile()).size).toBe(5);
    await saveFile('nested-model', 'config.json', new Blob(['{}']));
    await saveFile('nested-model', 'tokenizer/unknown-extra.txt', new Blob(['extra']));
    await saveFile('nested-model', 'onnx/stale.onnx.part', new Blob(['temp']));
    expect(await (await readFile('nested-model', 'onnx/model_quantized.onnx')).text()).toBe('model');
    const finalNames = ['onnx/model_quantized.onnx', 'config.json', 'tokenizer/unknown-extra.txt'];
    expect(await listFiles('nested-model')).toEqual(finalNames);
    await expect(readFile('nested-model','missing/file.onnx')).rejects.toMatchObject({name:'NotFoundError'});
    expect(dir.entriesMap.has('missing')).toBe(false);
    expect(await getStoredSize('nested-model')).toBe(12);
    expect(await getStoredSize('nested-model', { includeTemp: true })).toBe(16);
    expect(await getTotalStorageUsed()).toBe(16);
    expect(await listAllOpfsEntries()).toEqual([{modelId:'nested-model',totalSize:16,files:[
      {name:'onnx/model_quantized.onnx',size:5,isTemp:false}, {name:'onnx/stale.onnx.part',size:4,isTemp:true},
      {name:'config.json',size:2,isTemp:false}, {name:'tokenizer/unknown-extra.txt',size:5,isTemp:false},
    ]}]);
    const manifest: LocalModelManifest = {kind:'multi-file',requiredFiles:['config.json','onnx/model_quantized.onnx'],entrypoint:'onnx/model_quantized.onnx'};
    const provider = new OpfsFileProvider('nested-model', manifest);
    expect((await provider.getFileEntries()).map(([name]) => name)).toEqual(finalNames);
    expect(await (await provider.getCustomCache().match('https://huggingface.co/repo/resolve/main/onnx/model_quantized.onnx'))?.text()).toBe('model');
    expect(await verifyStoredModel('nested-model', manifest)).toBe('saved');
    await deleteModelFile('nested-model', 'tokenizer/unknown-extra.txt');
    expect(await listFiles('nested-model')).toEqual(finalNames.slice(0,2));
  });

  it('keeps required nested files partial while their marker remains', async () => {
    const manifest: LocalModelManifest = {kind:'multi-file',requiredFiles:['config.json','onnx/model.onnx'],entrypoint:'onnx/model.onnx'};
    await saveFile('marked-model', 'config.json', new Blob(['{}']));
    await saveFile('marked-model', 'onnx/model.onnx', new Blob(['incomplete body']));
    await saveFile('marked-model', 'onnx/optional.onnx.part', new Blob([]));
    expect(await verifyStoredModel('marked-model', manifest)).toBe('saved');
    await saveFile('marked-model', 'onnx/model.onnx.part', new Blob([]));
    expect(await verifyStoredModel('marked-model', manifest)).toBe('partial');
    expect(await new OpfsFileProvider('marked-model',manifest).isAvailable()).toBe(false);
    expect(await hasTempFile('marked-model','onnx/model.onnx')).toBe(true);
    expect(await (await readFile('marked-model','onnx/model.onnx')).text()).toBe('incomplete body');
  });

  it('resumes and commits nested downloads and copies legacy parts without losing failure information', async () => {
    const path = 'onnx/model.onnx';
    let writer = await openDownloadWriter('resume-nested', path, 0);
    await writer.write(new Uint8Array([1,2])); await writer.close();
    expect(await hasTempFile('resume-nested', path)).toBe(true);
    expect(await getTempFileSize('resume-nested', path)).toBe(2);
    writer = await openDownloadWriter('resume-nested', path, 2);
    await writer.write(new Uint8Array([3])); await writer.close();
    await commitTempFile('resume-nested', path);
    expect(new Uint8Array(await (await readFile('resume-nested', path)).arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
    expect(await hasTempFile('resume-nested', path)).toBe(false);
    await writeTempChunk('resume-nested', 'legacy/data.bin', new Uint8Array([4]), false);
    await writeTempChunk('resume-nested', 'legacy/data.bin', new Uint8Array([5]), true);
    expect(await getTempFileSize('resume-nested', 'legacy/data.bin')).toBe(2);
    await removeTempFile('resume-nested', 'legacy/data.bin');
    await saveFile('resume-nested', path + '.part', new Blob([new Uint8Array([6,7])]));
    const models = await root.getDirectoryHandle('models');
    const onnx = await (await models.getDirectoryHandle('resume-nested')).getDirectoryHandle('onnx');
    const final = await onnx.getFileHandle('model.onnx'); final.failClose = true;
    await expect(commitTempFile('resume-nested', path)).rejects.toMatchObject({name:'NoModificationAllowedError'});
    expect(new Uint8Array(await (await readFile('resume-nested', path)).arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
    expect(await getTempFileSize('resume-nested', path)).toBe(2);
    final.failClose = false;
    await commitTempFile('resume-nested', path);
    expect(new Uint8Array(await (await readFile('resume-nested', path)).arrayBuffer())).toEqual(new Uint8Array([6,7]));
    const sync = await createOPFSSyncWriter('resume-nested','deep/worker/output.bin');
    await sync.write(new Uint8Array([8,9])); await sync.close();
    expect(await getOPFSFileSize('resume-nested','deep/worker/output.bin')).toBe(2);
    await saveFile('resume-nested', path + '.part', new Blob([]));
    onnx.failRemove.add('model.onnx');
    await expect(removeTempFile('resume-nested', path)).rejects.toMatchObject({name:'NoModificationAllowedError'});
    expect(await hasTempFile('resume-nested', path)).toBe(true);
  });

  it('does not create missing read directories and rejects unsafe paths before writing', async () => {
    expect(await listFiles('missing')).toEqual([]);
    expect(await getOPFSFileSize('missing','onnx/file.onnx')).toBe(0);
    expect(await getTempFileSize('missing','onnx/file.onnx')).toBe(0);
    expect(await hasTempFile('missing','onnx/file.onnx')).toBe(false);
    await expect(readFile('missing','onnx/file.onnx')).rejects.toMatchObject({name:'NotFoundError'});
    expect(await listSavedModelIds()).toEqual([]);
    expect(await listAllOpfsEntries()).toEqual([]);
    expect(await getTotalStorageUsed()).toBe(0);
    expect(root.entriesMap.size).toBe(0);
    for (const path of ['', '/absolute.onnx', '../escape', 'onnx/../escape', 'onnx//file', 'onnx/./file', 'onnx/', 'C:/file', 'onnx\\file', 'onnx/zero\0file']) {
      await expect(saveFile('invalid', path, new Blob(['invalid']))).rejects.toBeInstanceOf(TypeError);
      await expect(readFile('invalid', path)).rejects.toBeInstanceOf(TypeError);
      await expect(getOPFSFileSize('invalid', path)).rejects.toBeInstanceOf(TypeError);
      await expect(writeTempChunk('invalid', path, new Uint8Array([1]), false)).rejects.toBeInstanceOf(TypeError);
      for (const query of [hasTempFile, getTempFileSize, commitTempFile, removeTempFile, deleteModelFile]) await expect(query('invalid', path)).rejects.toBeInstanceOf(TypeError);
    }
    expect(root.entriesMap.size).toBe(0);
    await root.getFileHandle('models',{create:true});
    await expect(readFile('model','onnx/file.onnx')).rejects.toMatchObject({name:'TypeMismatchError'});
    await expect(listFiles('model')).rejects.toMatchObject({name:'TypeMismatchError'});
    await expect(verifyStoredModel('model',{kind:'single-file',entrypoint:'file.onnx'})).rejects.toMatchObject({name:'TypeMismatchError'});
    expect(root.entriesMap.get('models')).toBeInstanceOf(FakeFileHandle);
  });

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
    await saveFile('delete-error', 'kept.gguf', new Blob(['kept']));
    const dir = await (await root.getDirectoryHandle('models')).getDirectoryHandle('delete-error');
    dir.failRemove.add('missing.gguf');
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
