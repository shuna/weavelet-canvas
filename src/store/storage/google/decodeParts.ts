import { decode } from './crypto';

export function decodeParts<T>(parts: Uint8Array[]): { bytes: Uint8Array; value: T } {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, value: decode<T>(bytes) };
}
