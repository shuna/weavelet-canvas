export const GGUF_FINGERPRINT_THRESHOLD = 64 * 1024 * 1024;
export const GGUF_FINGERPRINT_CHUNK_BYTES = 1024 * 1024;

export type GGUFingerprintPlan = {
  ranges: Array<{offset: number; length: number}>;
  suffix: string;
};

export function ggufFingerprintPlan(size: number): GGUFingerprintPlan {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('GGUF ファイルサイズが不正です。');
  if (size <= GGUF_FINGERPRINT_THRESHOLD) return {ranges: [{offset: 0, length: size}], suffix: ''};
  return {
    ranges: [
      {offset: 0, length: GGUF_FINGERPRINT_CHUNK_BYTES},
      {offset: size - GGUF_FINGERPRINT_CHUNK_BYTES, length: GGUF_FINGERPRINT_CHUNK_BYTES},
    ],
    suffix: String(size),
  };
}
