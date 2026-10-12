import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StoreState } from './store';
import type { PersistedStoreState } from './persistence';

const context = vi.hoisted(() => ({
  store: null as StoreApi<StoreState> | null,
  partialize: null as ((state: StoreState) => PersistedStoreState) | null,
}));
vi.mock('@src/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@utils/showToast', () => ({ showToast: vi.fn() }));
vi.mock('@store/store', () => ({
  default: {
    getState: () => context.store!.getState(),
    getInitialState: () => context.store!.getInitialState(),
    setState: (state: StoreState) => context.store!.setState(state),
  },
  createPartializedState: (state: StoreState) => context.partialize!(state),
}));

import {
  createPartializedState, createLocalStoragePartializedState, mergePersistedStoreState,
  preservePersistedRootsOnReplace, prepareHydratedState, finishHydratedState,
  hydrateFromPersistedStoreState, rehydrateStoreState, setIndexedDbMigrationComplete,
  migratePersistedState, clearNeedsDataMigration, needsDataMigration,
} from './persistence';
import { prepareHydratedData } from './rehydrateData';
import { toRecords, fromRecords } from './storage/google/records';
import { STORE_VERSION } from './version';
import { importChatFromFile } from '@components/ImportExportChat/importService';
import { createChatSlice } from './chat-slice';

const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/io-corpus.json', import.meta.url), 'utf8'));
const opaque = {
  xFuture: { nested: [{ future: true, text: '合成opaque' }], options: { delta: 'opaque' } },
  setChats: 'OPAQUE_METHOD_DATA', currentChatIndex: 314, sessionToken: 'OPAQUE_SAVED_VALUE',
};
let failWrite = false;
let stored = '';

function createTestStore(payload: Record<string, unknown>) {
  stored = JSON.stringify({ version: STORE_VERSION, state: payload });
  const known = structuredClone(corpus.syncSnapshot.state);
  delete known.xFixtureRoot;
  const store = createStore<StoreState>()(persist((originalSet, get, api) => {
    const set = preservePersistedRootsOnReplace(originalSet);
    api.setState = preservePersistedRootsOnReplace(api.setState);
    return {
      ...known, currentChatIndex: 0,
      sessionToken: 'FAKE_RUNTIME_ONLY_TOKEN', runtimeCache: { secret: 'FAKE_RUNTIME_ONLY_CACHE' },
      setTheme: (theme: StoreState['theme']) => set(state => ({ ...state, theme })),
      setChats: createChatSlice(set, get).setChats,
      invalidateBranchHistory: vi.fn(),
      setFolders: (folders: StoreState['folders']) => set({ folders }),
      setCurrentChatIndex: (currentChatIndex: number) => set({ currentChatIndex }),
    } as StoreState;
  }, {
    name: 'fake-test-only', version: STORE_VERSION, skipHydration: true,
    storage: createJSONStorage(() => ({
      getItem: () => stored,
      setItem: (_name, value) => { if (failWrite) throw new DOMException('fake quota', 'QuotaExceededError'); stored = value; },
      removeItem: () => { stored = ''; },
    })),
    merge: (persisted, current) => mergePersistedStoreState(current, persisted as Partial<PersistedStoreState>),
    partialize: createLocalStoragePartializedState,
    onRehydrateStorage: () => state => { if (state) rehydrateStoreState(state); },
    migrate: migratePersistedState,
  }));
  context.store = store;
  context.partialize = createPartializedState;
  void store.persist.rehydrate();
  return store;
}

beforeEach(() => {
  failWrite = false;
  clearNeedsDataMigration();
  localStorage.setItem('currentChatIndex', '0');
  setIndexedDbMigrationComplete(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setIndexedDbMigrationComplete(false);
});

describe('unknown persisted roots through actual hydration, operations and I/O', () => {
  it('keeps opaque runtime-name collisions separate from live methods and runtime secrets', async () => {
    const raw = structuredClone(opaque);
    const store = createTestStore(raw);
    expect(typeof store.getState().setChats).toBe('function');
    expect(store.getState().currentChatIndex).toBe(0);
    expect(store.getState()).toHaveProperty('sessionToken', 'FAKE_RUNTIME_ONLY_TOKEN');
    expect(store.getState()).not.toHaveProperty('xFuture');
    store.getState().setTheme('light');
    store.getState().setChats(store.getState().chats!.slice(), { contentStore: store.getState().contentStore });
    const saved = createPartializedState(store.getState());
    for (const [key, value] of Object.entries(opaque)) expect(saved).toHaveProperty(key, value);
    expect(saved.theme).toBe('light');
    expect(saved).not.toHaveProperty('runtimeCache');
    expect(JSON.stringify(saved)).not.toContain('FAKE_RUNTIME_ONLY');
    expect(Object.getOwnPropertySymbols(saved)).toHaveLength(0);
    const local = JSON.parse(stored);
    for (const [key, value] of Object.entries(opaque)) expect(local.state).toHaveProperty(key, value);
    expect(local.version).toBe(STORE_VERSION);
    expect(local.state).not.toHaveProperty('chats');
    const synced = await fromRecords(await toRecords({ version: STORE_VERSION, state: saved }));
    const hydrated = await prepareHydratedState(store.getState(), synced.state);
    store.setState(finishHydratedState(hydrated));
    store.getState().setTheme('dark');
    const after = createPartializedState(store.getState());
    for (const [key, value] of Object.entries(opaque)) expect(after).toHaveProperty(key, value);
    expect(after.defaultChatConfig).toEqual(saved.defaultChatConfig);
    expect(after.chats![0].branchTree!.nodes['n-inactive']).toHaveProperty('xFixtureNode', { unknown: 'keep-n-inactive' });
    expect(raw).toEqual(opaque);
  });

  it('retains provenance on replacement object/callback and invalidates both partialize caches', () => {
    const store = createTestStore(opaque);
    store.setState({ ...store.getInitialState(), theme: 'light' }, true);
    store.setState(state => ({ ...store.getInitialState(), theme: state.theme }), true);
    expect(createPartializedState(store.getState())).toHaveProperty('xFuture', opaque.xFuture);
    expect(createLocalStoragePartializedState(store.getState())).toHaveProperty('xFuture', opaque.xFuture);
    const full = createPartializedState(store.getState());
    const local = createLocalStoragePartializedState(store.getState());
    expect(createPartializedState(store.getState())).toBe(full);
    expect(createLocalStoragePartializedState(store.getState())).toBe(local);
    store.setState(mergePersistedStoreState(store.getState(), { xFuture: { updated: true } } as Partial<PersistedStoreState>));
    expect(createPartializedState(store.getState())).toHaveProperty('xFuture', { updated: true });
    expect(createLocalStoragePartializedState(store.getState())).toHaveProperty('xFuture', { updated: true });
    expect(createPartializedState(store.getState())).not.toBe(full);
    expect(createLocalStoragePartializedState(store.getState())).not.toBe(local);
  });

  it('retains unknown roots across structuredClone Worker preparation without transmitting runtime or opaque values', async () => {
    const store = createTestStore(opaque);
    const posted: unknown[] = [];
    vi.stubGlobal('Worker', class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      terminate() {}
      postMessage(message: { id: number; value: Parameters<typeof prepareHydratedData>[0] }) {
        const copy = structuredClone(message);
        posted.push(copy);
        const prepared = prepareHydratedData(copy.value);
        this.onmessage?.({ data: { id: copy.id, value: structuredClone(prepared), metrics: {} } });
      }
    });
    const incoming = { theme: 'light' as const, xWorker: { future: ['keep'] }, setChats: 'OPAQUE_WORKER_METHOD' };
    const before = structuredClone(incoming);
    const prepared = await prepareHydratedState(store.getState(), incoming);
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted)).not.toContain('OPAQUE');
    expect(posted[0]).toHaveProperty('value.persisted', { theme: 'light' });
    store.setState(finishHydratedState(prepared));
    const saved = createPartializedState(store.getState());
    expect(saved).toHaveProperty('xWorker', { future: ['keep'] });
    expect(saved).toHaveProperty('xFuture', opaque.xFuture);
    expect(saved).toHaveProperty('setChats', 'OPAQUE_WORKER_METHOD');
    expect(typeof store.getState().setChats).toBe('function');
    expect(incoming).toEqual(before);
  });

  it('keeps actions callable and opaque roots separate after replacing from a valid file', async () => {
    const store = createTestStore(opaque);
    const setChats = store.getState().setChats;
    vi.stubGlobal('FileReader', class {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      readAsText(file: File) { file.text().then(result => this.onload?.({ target: { result } })); }
    });
    const result = await importChatFromFile(new File([JSON.stringify(corpus.exportV3)], 'valid.json'), key => key, 'replace', false);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(store.getState().setChats).toBe(setChats);
    expect(store.getState()).not.toHaveProperty('xFuture');
    const saved = createPartializedState(store.getState());
    expect(saved).toHaveProperty('setChats', opaque.setChats);
    expect(saved).toHaveProperty('xFuture', opaque.xFuture);
    store.getState().setChats(store.getState().chats!.slice(), { preserveBranchHistory: true });
    expect(typeof store.getState().setChats).toBe('function');
  });

  it('keeps opaque roots on failed save and import rollback, and preserves the migration contract', async () => {
    const store = createTestStore(opaque);
    const disk = stored;
    failWrite = true;
    expect(() => store.getState().setTheme('light')).toThrow('fake quota');
    expect(stored).toBe(disk);
    expect(createPartializedState(store.getState())).toHaveProperty('xFuture', opaque.xFuture);
    failWrite = false;
    store.getState().setTheme('dark');
    vi.stubGlobal('FileReader', class {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      readAsText(file: File) { file.text().then(result => this.onload?.({ target: { result } })); }
    });
    const result = await importChatFromFile(new File(['{"invalid":"fake"}'], 'fake-invalid.json'), key => key);
    expect(result.success, JSON.stringify(result)).toBe(false);
    expect(typeof store.getState().setChats).toBe('function');
    expect(createPartializedState(store.getState())).toHaveProperty('setChats', opaque.setChats);
    expect(createPartializedState(store.getState())).toHaveProperty('xFuture', opaque.xFuture);
    const raw = structuredClone(opaque);
    expect(migratePersistedState(raw, STORE_VERSION - 1)).toBe(raw);
    expect(needsDataMigration()).toBe(true);
    store.setState(hydrateFromPersistedStoreState(store.getState(), raw as Partial<PersistedStoreState>));
    expect(createPartializedState(store.getState())).toHaveProperty('xFuture', opaque.xFuture);
  });

  it('does not discover new runtime fields and rejects noncloneable persisted roots without mutating live state', () => {
    const store = createTestStore(opaque);
    const before = createPartializedState(store.getState());
    expect(mergePersistedStoreState(store.getState(), undefined as unknown as Partial<PersistedStoreState>)).toBe(store.getState());
    store.setState({ injectedRuntime: 'FAKE_RUNTIME_ONLY_INJECTED' } as Partial<StoreState>);
    expect(createPartializedState(store.getState())).not.toHaveProperty('injectedRuntime');
    expect(() => mergePersistedStoreState(store.getState(), { xFunction: () => {} } as Partial<PersistedStoreState>)).toThrow();
    expect(createPartializedState(store.getState())).toBe(before);
  });

  it('keeps prototype-named opaque roots without applying them to runtime, while sync rejects unsafe paths explicitly', async () => {
    const raw = JSON.parse('{"__proto__":{"fake":"keep"},"constructor":"opaque constructor"}');
    const store = createTestStore(raw);
    expect(Object.getPrototypeOf(store.getState())).toBe(Object.prototype);
    expect(Object.hasOwn(store.getState(), '__proto__')).toBe(false);
    const saved = createPartializedState(store.getState());
    expect(Object.hasOwn(saved, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(saved))).toHaveProperty('constructor', 'opaque constructor');
    await expect(toRecords({ version: STORE_VERSION, state: saved })).rejects.toThrow('Unsafe sync record key');
    expect(createPartializedState(store.getState())).toHaveProperty('__proto__', { fake: 'keep' });
  });
});
