import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { StateStorage } from 'zustand/middleware';

const compressedStorage: StateStorage = {
  getItem: (name: string): string | null => {
    const raw = localStorage.getItem(name);
    if (raw === null) return null;

    // Backward compatibility: detect uncompressed JSON
    const firstChar = raw.charAt(0);
    if (firstChar === '{' || firstChar === '"') {
      return raw;
    }

    // Compressed data
    return decompressFromUTF16(raw);
  },

  setItem: (name: string, value: string): void => {
    localStorage.setItem(name, compressToUTF16(value));
  },

  removeItem: (name: string): void => {
    localStorage.removeItem(name);
  },
};

export default compressedStorage;
