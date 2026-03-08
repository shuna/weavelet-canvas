import { vi } from 'vitest';

globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (typeof input === 'string' && input === 'models.json') {
    return {
      json: async () => ({ data: [] }),
    } as Response;
  }

  throw new Error(`Unexpected fetch in tests: ${String(input)}`);
}) as typeof fetch;

vi.mock('@store/store', () => ({
  default: {
    getState: () => ({
      customModels: [],
      totalTokenUsed: {},
      setTotalTokenUsed: () => {},
    }),
  },
}));

const localStorageStore = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageStore.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageStore.delete(key);
    },
    clear: () => {
      localStorageStore.clear();
    },
  },
  configurable: true,
});
