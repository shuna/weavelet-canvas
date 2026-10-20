import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryStore, DIAGNOSTIC_TTL_MS } from '../src/recoveryStore';
import { startDiagnostic } from '../src/diagnostics';

function fixture() {
  const data = new Map<string, unknown>();
  const storage = {
    async get(key: string | string[]) { if (Array.isArray(key) && key.length > 128) throw new Error('Too many keys'); return Array.isArray(key) ? new Map(key.filter(k => data.has(k)).map(k => [k, data.get(k)])) : data.get(key); },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'string') data.set(key, structuredClone(value));
      else {
        if (Object.keys(key).length > 128) throw new Error('Too many keys');
        for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
      }
    },
    async delete(keys: string[]) { for (const key of keys) data.delete(key); },
    async list() { return new Map(data); },
    async deleteAll() { data.clear(); },
    deleteAlarm: vi.fn(async () => {}),
    setAlarm: vi.fn(async (_at: number) => {}),
    async transaction<T>(fn: (tx: unknown) => Promise<T>) { return fn(storage); },
  };
  return { data, storage, store: new RecoveryStore(storage as unknown as DurableObjectStorage) };
}
const key = new Request('https://proxy.test/session');
const snapshot = (body: string, expiresAt = Date.now() + 300_000) => new Response(body, { headers: { 'X-Weavelet-Status': JSON.stringify({ firstEventId: 1, lastEventId: 666, terminal: 'interrupted', expiresAt }) } });
afterEach(() => vi.useRealTimers());

describe('durable recovery storage', () => {
  it('restores bounded Unicode snapshots and diagnostics through a new instance', async () => {
    const { store, storage, data } = fixture();
    const body = '応答🙂'.repeat(90_000);
    await store.saveDiagnostic(startDiagnostic('durable-unicode'));
    await store.put(key, snapshot(body));
    const restored = new RecoveryStore(storage as unknown as DurableObjectStorage);
    expect(await (await restored.match(key))!.text()).toBe(body);
    expect((await restored.diagnostic())?.sessionId).toBe('durable-unicode');
    expect((await restored.summary()).lastEventId).toBe(666);
    expect([...data.keys()].filter(k => k.startsWith('body:')).length).toBeGreaterThan(10);
  });
  it('batches escaped response values within storage operation limits', async () => {
    const { store } = fixture();
    const body = JSON.stringify('\u0000'.repeat(1_000_000));
    await store.put(key, snapshot(body));
    expect(await (await store.match(key))!.text()).toBe(body);
    await store.delete(key);
    expect(await store.match(key)).toBeUndefined();
  });
  it('expires response bodies after five minutes, retains the reason, then removes all records after 24 hours', async () => {
    vi.useFakeTimers();
    const { store, data } = fixture();
    await store.saveDiagnostic(startDiagnostic('durable-expiry'));
    await store.put(key, snapshot('reply'));
    await vi.advanceTimersByTimeAsync(300_001);
    expect(await store.match(key)).toBeUndefined();
    expect((await store.summary()).state).toBe('expired');
    await store.alarm();
    expect(data.has('body:0')).toBe(false);
    expect(await store.diagnostic()).toBeDefined();
    await vi.advanceTimersByTimeAsync(DIAGNOSTIC_TTL_MS);
    await store.alarm();
    expect(data.size).toBe(0);
    expect((await store.summary()).state).toBe('not-recorded');
  });
  it('purges response and diagnostics without letting delayed writes or ACK recreate records', async () => {
    const { store, data, storage } = fixture();
    const diagnostic = startDiagnostic('purge-record');
    await store.saveDiagnostic(diagnostic);
    await store.put(key, snapshot('private response'));
    await store.purge();
    expect(data.size).toBe(0);
    expect(storage.deleteAlarm).toHaveBeenCalled();
    await store.put(key, snapshot('late response'));
    await expect(store.saveDiagnostic(diagnostic)).rejects.toThrow('deleted');
    await store.delete(key);
    expect(data.size).toBe(0);
    expect((await store.summary()).state).toBe('not-recorded');
  });
  it('acknowledges even before the first snapshot and never recreates deleted responses', async () => {
    const { store } = fixture();
    expect((await store.summary()).state).toBe('not-recorded');
    await store.saveDiagnostic(startDiagnostic('durable-ack'));
    expect((await store.summary()).state).toBe('not-saved');
    await store.delete(key);
    await store.put(key, snapshot('late final response'));
    expect(await store.match(key)).toBeUndefined();
    expect((await store.summary()).state).toBe('acknowledged');
  });
});
