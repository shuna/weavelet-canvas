type Decoder = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  ZSTD_isError(result: number): number;
  ZSTD_findFrameCompressedSize(input: number, length: number): number;
  ZSTD_getFrameContentSize(input: number, length: number): bigint;
  ZSTD_getDictID_fromFrame(input: number, length: number): number;
  ZSTD_decompress(output: number, capacity: number, input: number, length: number): number;
};

const MAX_BYTES = 128 * 1024 * 1024;
let pending: Promise<Decoder> | undefined;
function loadDecoder(): Promise<Decoder> {
  return pending ??= (async () => {
    const response = await fetch(new URL('./zstd.wasm', import.meta.url));
    if (!response.ok) throw new Error('Unable to load the Zstandard decoder.');
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {
      // Views are created after each allocation, so no cached view needs refreshing.
      env: { emscripten_notify_memory_growth() {} },
    });
    const decoder = instance.exports as unknown as Decoder;
    decoder._initialize();
    return decoder;
  })().catch(error => { pending = undefined; throw error; });
}

/** Decodes exactly one dictionary-free Zstandard frame into a bounded detached buffer. */
export async function decompressZstd(payload: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  if (!Number.isInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_BYTES) {
    throw new Error('Invalid Zstandard decoded size.');
  }
  if (payload.byteLength > MAX_BYTES) throw new Error('Zstandard input exceeds the size limit.');
  if (payload.length < 4 || payload[0] !== 0x28 || payload[1] !== 0xb5 || payload[2] !== 0x2f || payload[3] !== 0xfd) {
    throw new Error('Invalid Zstandard frame.');
  }
  const decoder = await loadDecoder();
  let input = 0, output = 0;
  try {
    input = decoder.malloc(payload.length);
    if (!input) throw new Error('Unable to allocate Zstandard input.');
    new Uint8Array(decoder.memory.buffer, input, payload.length).set(payload);
    const frameLength = decoder.ZSTD_findFrameCompressedSize(input, payload.length);
    if (decoder.ZSTD_isError(frameLength) || frameLength !== payload.length) {
      throw new Error('Invalid or trailing Zstandard frame data.');
    }
    const size = BigInt.asUintN(64, decoder.ZSTD_getFrameContentSize(input, payload.length));
    if (size !== 0xffffffffffffffffn && size !== BigInt(expectedSize)) {
      throw new Error('Zstandard frame size does not match the container.');
    }
    if (decoder.ZSTD_getDictID_fromFrame(input, payload.length) !== 0) {
      throw new Error('Zstandard dictionaries are not supported.');
    }
    output = decoder.malloc(Math.max(1, expectedSize));
    if (!output) throw new Error('Unable to allocate Zstandard output.');
    const actualSize = decoder.ZSTD_decompress(output, expectedSize, input, payload.length);
    if (decoder.ZSTD_isError(actualSize) || actualSize !== expectedSize) {
      throw new Error('Invalid Zstandard data or decoded size.');
    }
    return new Uint8Array(decoder.memory.buffer, output, actualSize).slice();
  } finally {
    if (output) decoder.free(output);
    if (input) decoder.free(input);
  }
}
