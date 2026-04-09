/**
 * Q4_0 quantization (Round-to-Nearest, symmetric).
 *
 * Q4_0 block structure (18 bytes per block, 32 elements):
 *   - delta: fp16 (2 bytes) — scale = max(abs(block)) / 7
 *   - qs[16]: uint8 (16 bytes) — packed 4-bit values, low nibble first
 *
 * Quantization:  qi = clamp(round(x / delta) + 8, 0, 15)
 * Dequantization: x ≈ (qi - 8) * delta
 *
 * This matches ggml's Q4_0 format exactly, so quantized tensors written with
 * this function are natively loadable by llama.cpp / ggml without any custom
 * kernel code.
 */

import { fp32ToFp16 } from './dequantize';

const BLOCK_SIZE = 32;
/** Bytes per Q4_0 block: 2 (fp16 scale) + 16 (packed nibbles) */
export const Q4_0_BYTES_PER_BLOCK = 18;

/**
 * Compute the output byte size for Q4_0-quantized data with the given element count.
 */
export function q4_0SizeBytes(elements: number): number {
  return Math.ceil(elements / BLOCK_SIZE) * Q4_0_BYTES_PER_BLOCK;
}

/**
 * Quantize a flat fp32 weight array to Q4_0 format.
 *
 * The input is treated as a flat array of `elements` values.
 * The output is a Uint8Array in ggml Q4_0 binary layout.
 */
export function quantizeQ4_0(weights: Float32Array): Uint8Array {
  const elements = weights.length;
  const nBlocks = Math.ceil(elements / BLOCK_SIZE);
  const out = new Uint8Array(nBlocks * Q4_0_BYTES_PER_BLOCK);
  const view = new DataView(out.buffer);

  for (let b = 0; b < nBlocks; b++) {
    const blockStart = b * BLOCK_SIZE;
    const blockEnd = Math.min(blockStart + BLOCK_SIZE, elements);
    const blockOffset = b * Q4_0_BYTES_PER_BLOCK;

    // Find max absolute value in block → scale
    let amax = 0;
    for (let i = blockStart; i < blockEnd; i++) {
      const av = Math.abs(weights[i]);
      if (av > amax) amax = av;
    }

    const delta = amax / 7.0;
    const invDelta = delta > 0 ? 1.0 / delta : 0;

    // Write fp16 scale
    view.setUint16(blockOffset, fp32ToFp16(delta), true);

    // Pack 32 quantized values into 16 bytes (2 nibbles per byte, low nibble first)
    for (let i = 0; i < 16; i++) {
      const baseIdx = blockStart + i * 2;

      // Low nibble: even element index within block
      let q0 = 8; // default for padding elements
      if (baseIdx < blockEnd) {
        const qi = Math.round(weights[baseIdx] * invDelta) + 8;
        q0 = Math.max(0, Math.min(15, qi));
      }

      // High nibble: odd element index within block
      let q1 = 8; // default for padding elements
      if (baseIdx + 1 < blockEnd) {
        const qi = Math.round(weights[baseIdx + 1] * invDelta) + 8;
        q1 = Math.max(0, Math.min(15, qi));
      }

      out[blockOffset + 2 + i] = (q1 << 4) | q0;
    }
  }

  return out;
}
