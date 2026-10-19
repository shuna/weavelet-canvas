import { DIAGNOSTIC_TTL_MS } from './recoveryStore';

interface RegistryEnv { SESSIONS: DurableObjectNamespace }
// Only opaque object IDs are indexed; response bodies and credentials stay in their session.
export class SessionRegistry {
  constructor(private state: DurableObjectState, private env: RegistryEnv) {}
  async fetch(request: Request) {
    const url = new URL(request.url), storage = this.state.storage;
    if (request.method === 'PUT') {
      const { objectId } = await request.json() as { objectId: string };
      if (!/^[a-f0-9]{64}$/.test(objectId)) return new Response('Invalid object ID', { status: 400 });
      const key = 'session:' + objectId;
      const existing = await storage.get<{ createdAt: number; expiresAt: number }>(key);
      if (existing && existing.expiresAt > Date.now() + DIAGNOSTIC_TTL_MS) return Response.json({ registered: true });
      await storage.put(key, { createdAt: existing?.createdAt ?? Date.now(), expiresAt: Date.now() + 2 * DIAGNOSTIC_TTL_MS });
      if (await storage.getAlarm() === null) await storage.setAlarm(Date.now() + DIAGNOSTIC_TTL_MS);
      return Response.json({ registered: true });
    }
    if (request.method === 'DELETE' && url.pathname === '/session') {
      await storage.delete('session:' + url.searchParams.get('objectId'));
      return Response.json({ deleted: true });
    }
    if (request.method === 'DELETE' && url.pathname === '/all') {
      const before = Number(url.searchParams.get('before') ?? Date.now());
      const cursor = url.searchParams.get('cursor') ?? '';
      if (!Number.isSafeInteger(before) || before < 0 || before > Date.now() || (cursor && !/^session:[a-f0-9]{64}$/.test(cursor)))
        return new Response('Invalid deletion cursor', { status: 400 });
      const records = await storage.list<{ createdAt: number }>({ prefix: 'session:', limit: 20, ...(cursor ? { startAfter: cursor } : {}) });
      let deleted = 0, failed = 0;
      await Promise.all([...records].map(async ([key, record]) => {
        if (record.createdAt > before) return;
        try {
          const object = this.env.SESSIONS.get(this.env.SESSIONS.idFromString(key.slice(8)));
          const result = await object.fetch('https://session.internal/internal/storage', { method: 'DELETE' });
          if (!result.ok) throw new Error('Session deletion failed');
          await storage.delete(key);
          deleted++;
        } catch { failed++; }
      }));
      return Response.json({ deleted, failed, before, cursor: records.size === 20 ? [...records.keys()].at(-1) : null });
    }
    return new Response('Not Found', { status: 404 });
  }
  async alarm() {
    let cursor: string | undefined;
    while (true) {
      const records = await this.state.storage.list<{ expiresAt: number }>({ prefix: 'session:', limit: 100, ...(cursor ? { startAfter: cursor } : {}) });
      const expired = [...records].filter(([, record]) => record.expiresAt <= Date.now()).map(([key]) => key);
      if (expired.length) await this.state.storage.delete(expired);
      if (records.size < 100) break;
      cursor = [...records.keys()].at(-1);
    }
    if ((await this.state.storage.list({ prefix: 'session:', limit: 1 })).size)
      await this.state.storage.setAlarm(Date.now() + DIAGNOSTIC_TTL_MS);
  }
}
