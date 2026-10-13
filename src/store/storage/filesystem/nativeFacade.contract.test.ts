import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeFileSystemDirectory, savedNativeFileSystemTarget, setFileSystemHost } from '../../../../shared/google-sync/adapters/filesystem';
import { FileSystemTransport } from './transport';

vi.mock('./handleStore', () => ({ savedFileSystemTarget: async () => undefined }));

const files = new Map<string, Uint8Array>();
const directories = new Set<string>();
let target: any;
let rejectWrites = false;
const missing = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });

beforeEach(() => {
  files.clear(); directories.clear(); target = undefined; rejectWrites = false;
  setFileSystemHost(async (method, args) => {
    if (method === 'fs.list') return [...files.keys()].map(name => ({ name, kind: 'file' })).concat([...directories].map(name => ({ name, kind: 'directory' })));
    if (method === 'fs.read') {
      const value = files.get(args[0] as string);
      if (!value) throw missing();
      return Array.from(value);
    }
    if (method === 'fs.write') {
      if (rejectWrites) throw new Error('write failed');
      const [name, next, expected] = args as [string, number[], number[] | null];
      const current = files.get(name);
      if ((expected === null) !== (current === undefined) || (expected && (!current || expected.length !== current.length || expected.some((value, index) => value !== current[index])))) {
        throw new Error('compare-and-swap failed');
      }
      files.set(name, new Uint8Array(next)); return null;
    }
    if (method === 'fs.target') {
      if (args[0] === 'get') return target ?? null;
      if (args[0] === 'clear') { target = undefined; return null; }
      target = args[1]; return null;
    }
    throw new Error(`unexpected ${method}`);
  });
});

describe('native filesystem facade', () => {
  it('stages new bytes until the atomic compare-and-swap close', async () => {
    const handle = await nativeFileSystemDirectory().getFileHandle('first.bin', { create: true });
    const writer = await handle.createWritable({ mode: 'exclusive' });
    await writer.write(new Uint8Array([1, 2]));
    expect(files.has('first.bin')).toBe(false);
    await writer.close();
    expect(files.get('first.bin')).toEqual(new Uint8Array([1, 2]));
  });

  it('rejects a competing change and leaves its bytes intact', async () => {
    files.set('same.bin', new Uint8Array([1]));
    const handle = await nativeFileSystemDirectory().getFileHandle('same.bin', { create: true });
    const writer = await handle.createWritable({ mode: 'exclusive' });
    await writer.write(new Uint8Array([2]));
    files.set('same.bin', new Uint8Array([3]));
    await expect(writer.close()).rejects.toThrow('compare-and-swap');
    expect(files.get('same.bin')).toEqual(new Uint8Array([3]));
  });

  it('keeps target metadata separate from the native folder handle', async () => {
    await savedNativeFileSystemTarget({ handle: nativeFileSystemDirectory(), dataset: 'fs-dataset', initialized: false, headerId: 'fs-header' });
    await expect(savedNativeFileSystemTarget()).resolves.toMatchObject({ dataset: 'fs-dataset', headerId: 'fs-header', handle: nativeFileSystemDirectory() });
    await savedNativeFileSystemTarget(null);
    await expect(savedNativeFileSystemTarget()).resolves.toBeUndefined();
  });

  it('does not create a zero-byte file after a failed close', async () => {
    const handle = await nativeFileSystemDirectory().getFileHandle('failed.bin', { create: true });
    const writer = await handle.createWritable({ mode: 'exclusive' });
    await writer.write(new Uint8Array([1]));
    rejectWrites = true;
    await expect(writer.close()).rejects.toThrow('write failed');
    expect(files.has('failed.bin')).toBe(false);
  });

  it('keeps native subdirectories visible to the Web transport checks', async () => {
    directories.add('nested');
    const transport = new FileSystemTransport(nativeFileSystemDirectory());
    await expect(transport.folder('fs-00000000-0000-4000-8000-000000000001', 'fs-00000000-0000-4000-8000-000000000002')).rejects.toThrow('空の専用');
  });

  it('keeps a .bin-named directory visible as a conflicting copy', async () => {
    const dataset = 'fs-00000000-0000-4000-8000-000000000001';
    const header = 'fs-00000000-0000-4000-8000-000000000002';
    files.set('weavelet-sync.json', new TextEncoder().encode(JSON.stringify({ version: 1, dataset, headerId: header })));
    directories.add('fs-00000000-0000-4000-8000-000000000003.part.bin');
    await expect(new FileSystemTransport(nativeFileSystemDirectory()).changes('[]')).rejects.toThrow('競合コピー');
  });
});
