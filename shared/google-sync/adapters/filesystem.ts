type Request = (method: string, args: unknown[]) => Promise<any>;

let request: Request | undefined;
export const setFileSystemHost = (next: Request) => { request = next; };
const call = (method: string, ...args: unknown[]) => {
  if (!request) throw new Error('File system host is unavailable.');
  return request(method, args);
};
const bytes = (value: number[]) => new Uint8Array(value);
const same = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((value, index) => value === right[index]);

class NativeFileHandle {
  readonly kind = 'file';
  constructor(readonly name: string, private readonly create: boolean) {}
  private async read() {
    try { return bytes(await call('fs.read', this.name)); }
    catch (error) { if (this.create && error instanceof Error && error.name === 'NotFoundError') return new Uint8Array(); throw error; }
  }
  async getFile() {
    const value = await this.read();
    return {
      size: value.length,
      arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      text: async () => new TextDecoder().decode(value),
    } as File;
  }
  async createWritable(_options?: { mode?: string }) {
    let expected: Uint8Array | null;
    try { expected = bytes(await call('fs.read', this.name)); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'NotFoundError') throw error; expected = null; }
    let staged = new Uint8Array();
    let closed = false;
    return {
      write: async (value: string | Uint8Array) => { staged = typeof value === 'string' ? new TextEncoder().encode(value) : value.slice(); },
      close: async () => {
        if (closed) return;
        await call('fs.write', this.name, Array.from(staged), expected && Array.from(expected));
        closed = true;
      },
      abort: async () => { closed = true; },
    } as any;
  }
}

class NativeDirectoryHandle {
  readonly name = 'native-sync';
  readonly kind = 'directory';
  async isSameEntry(other: unknown) { return other === this; }
  async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
    if (!options?.create) await call('fs.read', name);
    return new NativeFileHandle(name, options?.create === true) as unknown as FileSystemFileHandle;
  }
  async *values() {
    for (const entry of await call('fs.list')) {
      if (entry.kind === 'file') yield new NativeFileHandle(entry.name, false) as unknown as FileSystemFileHandle;
      else yield { name: entry.name, kind: entry.kind } as FileSystemHandle;
    }
  }
}

const directory = new NativeDirectoryHandle() as unknown as FileSystemDirectoryHandle;
export const nativeFileSystemDirectory = () => directory;

export type NativeFileSystemTarget = {
  dataset: string;
  initialized: boolean;
  downloadPending?: boolean;
  headerId?: string;
};

export async function savedNativeFileSystemTarget(value?: (NativeFileSystemTarget & { handle: FileSystemDirectoryHandle }) | null) {
  if (value === undefined) {
    const saved = await call('fs.target', 'get') as NativeFileSystemTarget | null;
    return saved ? { ...saved, handle: directory } : undefined;
  }
  await call('fs.target', value === null ? 'clear' : 'set', value === null ? undefined : {
    dataset: value.dataset, initialized: value.initialized, downloadPending: value.downloadPending, headerId: value.headerId,
  });
  return value ?? undefined;
}

export const sameBytes = same;
