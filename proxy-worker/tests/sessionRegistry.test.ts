import { afterEach, expect, it, vi } from 'vitest';
import { SessionRegistry } from '../src/sessionRegistry';

function fixture() {
  const records = new Map<string, unknown>();
  const storage = {
    async get(key: string) { return records.get(key); },
    async put(key: string, value: unknown) { records.set(key, value); },
    async delete(key: string | string[]) { for (const k of Array.isArray(key) ? key : [key]) records.delete(k); },
    async list(options: { prefix: string; limit: number; startAfter?: string }) { return new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(options.prefix) && (!options.startAfter || key > options.startAfter)).slice(0, options.limit)); },
    getAlarm: vi.fn(async () => null), setAlarm: vi.fn(async () => {}),
  };
  const deleting = vi.fn(async () => Response.json({ deleted: true }));
  const env = { SESSIONS: { idFromString: (id: string) => id, get: () => ({ fetch: deleting }) } };
  const registry = new SessionRegistry({ storage } as unknown as DurableObjectState, env as never);
  const register = (id: string) => registry.fetch(new Request('https://registry/session', { method: 'PUT', body: JSON.stringify({ objectId: id }) }));
  return { registry, records, deleting, register };
}
afterEach(() => vi.useRealTimers());
it('deletes registered sessions across pages and excludes requests registered after the cutoff', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const { registry, records, deleting, register } = fixture();
  for (let n = 0; n < 25; n++) await register(n.toString(16).padStart(64, '0'));
  const first = await (await registry.fetch(new Request('https://registry/all', { method: 'DELETE' }))).json();
  expect(first.deleted).toBe(20); expect(first.cursor).toBeTruthy();
  vi.setSystemTime(2000);
  await register('f'.repeat(64));
  const second = await (await registry.fetch(new Request(`https://registry/all?before=${first.before}&cursor=${first.cursor}`, { method: 'DELETE' }))).json();
  expect(second.deleted).toBe(5); expect(second.cursor).toBeNull();
  expect(deleting).toHaveBeenCalledTimes(25);
  expect(records.size).toBe(1);
});
it('retains failed deletions for retry instead of reporting success', async () => {
  const { registry, records, deleting, register } = fixture();
  await register('a'.repeat(64));
  deleting.mockRejectedValueOnce(new Error('unavailable'));
  const failed = await (await registry.fetch(new Request('https://registry/all', { method: 'DELETE' }))).json();
  expect(failed).toMatchObject({ deleted: 0, failed: 1 }); expect(records.size).toBe(1);
  const retried = await (await registry.fetch(new Request('https://registry/all', { method: 'DELETE' }))).json();
  expect(retried).toMatchObject({ deleted: 1, failed: 0 }); expect(records.size).toBe(0);
});
it('rejects invalid object IDs and bulk deletion cursors', async () => {
  const { registry, register } = fixture();
  expect((await register('invalid')).status).toBe(400);
  expect((await registry.fetch(new Request('https://registry/all?cursor=invalid', { method: 'DELETE' }))).status).toBe(400);
});

it('lists every registered environment in pages without exposing response bodies', async () => {
  const { registry, register, deleting } = fixture();
  for (let n = 0; n < 25; n++) await register(n.toString(16).padStart(64, '0'));
  deleting.mockImplementation(async () => Response.json({ session: { sessionId: 'known-server-session', local: { phase: 'complete' }, cache: { state: 'available' } } }));
  const first = await (await registry.fetch(new Request('https://registry/all'))).json();
  expect(first.sessions).toHaveLength(20); expect(first.failed).toBe(0); expect(first.cursor).toBeTruthy();
  expect(deleting).toHaveBeenCalledWith('https://session.internal/internal/status');
  const second = await (await registry.fetch(new Request(`https://registry/all?cursor=${first.cursor}`))).json();
  expect(second.sessions).toHaveLength(5); expect(second.cursor).toBeNull();
  expect((await registry.fetch(new Request('https://registry/all?cursor=invalid'))).status).toBe(400);
});
it('distinguishes absent records from unavailable session objects in global status', async () => {
  const { registry, register, deleting } = fixture();
  await register('a'.repeat(64)); await register('b'.repeat(64));
  deleting.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(Response.json({ session: null }));
  const result = await (await registry.fetch(new Request('https://registry/all'))).json();
  expect(result.sessions).toEqual([]); expect(result.failed).toBe(1);
});
