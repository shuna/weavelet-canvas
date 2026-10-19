import type { SessionDiagnostic } from './diagnostics';

export const DIAGNOSTIC_TTL_MS = 86_400_000;
type Saved = { headers: [string, string][]; parts: number; expiresAt: number; diagnosticExpiresAt: number; deleted?: boolean };
export interface RecoveryCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
  delete(key: Request): Promise<boolean>;
}

async function deleteParts(storage: DurableObjectTransaction, count: number, start = 0) {
  for (let n = start; n < count; n += 100)
    await storage.delete(Array.from({ length: Math.min(100, count - n) }, (_, offset) => `body:${n + offset}`));
}

// Each session has its own object; metadata and the bounded response commit together.
export class RecoveryStore implements RecoveryCache {
  constructor(private storage: DurableObjectStorage) {}
  async diagnostic() { return this.storage.get<SessionDiagnostic>('diagnostic'); }
  async saveDiagnostic(diagnostic: SessionDiagnostic) {
    await this.storage.transaction(async tx => {
      await tx.put('diagnostic', { ...diagnostic });
      const saved = await tx.get<Saved>('saved');
      await tx.setAlarm(saved && !saved.deleted && saved.expiresAt > Date.now() ? saved.expiresAt : Date.now() + DIAGNOSTIC_TTL_MS);
    });
  }

  async summary() {
    const saved = await this.storage.get<Saved>('saved');
    if (!saved) return { state: await this.storage.get('acknowledged') ? 'acknowledged' : await this.diagnostic() ? 'not-saved' : 'not-recorded' };
    const summary = JSON.parse(saved.headers.find(([key]) => key === 'x-weavelet-status')![1]);
    return { ...summary, state: saved.deleted ? 'acknowledged' : saved.expiresAt <= Date.now() ? 'expired' : 'available' };
  }
  async match(_key: Request): Promise<Response | undefined> {
    return this.storage.transaction(async tx => {
      const saved = await tx.get<Saved>('saved');
      if (!saved || saved.deleted || saved.expiresAt <= Date.now()) return undefined;
      const keys = Array.from({ length: saved.parts }, (_, n) => `body:${n}`);
      const values = new Map<string, string>();
      for (let n = 0; n < keys.length; n += 100)
        for (const [key, value] of await tx.get<string>(keys.slice(n, n + 100))) values.set(key, value);
      if (values.size !== keys.length) throw new Error('Incomplete recovery snapshot');
      return new Response(keys.map(key => values.get(key)!).join(''), { headers: saved.headers });
    });
  }
  async put(_key: Request, response: Response) {
    const body = await response.text();
    const headers = [...response.headers.entries()] as [string, string][];
    const summary = JSON.parse(response.headers.get('X-Weavelet-Status')!);
    await this.storage.transaction(async tx => {
      const previous = await tx.get<Saved>('saved');
      if (previous?.deleted || await tx.get('acknowledged')) return; // A delayed final write must not undo acknowledgement.
      const parts = Math.ceil(body.length / 32_768);
      const values: Record<string, unknown> = {};
      // 32K UTF-16 code units stay below the storage value limit, including non-ASCII text.
      for (let n = 0; n < parts; n++) values[`body:${n}`] = body.slice(n * 32_768, (n + 1) * 32_768);
      values.saved = { headers, parts, expiresAt: summary.expiresAt, diagnosticExpiresAt: Date.now() + DIAGNOSTIC_TTL_MS } satisfies Saved;
      const entries = Object.entries(values);
      for (let n = 0; n < entries.length; n += 100) await tx.put(Object.fromEntries(entries.slice(n, n + 100)));
      if (previous && previous.parts > parts) await deleteParts(tx, previous.parts, parts);
      await tx.setAlarm(summary.expiresAt);
    });
  }
  async delete(_key: Request) {
    return this.storage.transaction(async tx => {
      const saved = await tx.get<Saved>('saved');
      await tx.put('acknowledged', true);
      if (!saved) { await tx.setAlarm(Date.now() + DIAGNOSTIC_TTL_MS); return false; }
      await deleteParts(tx, saved.parts);
      await tx.put('saved', { ...saved, parts: 0, deleted: true });
      await tx.setAlarm(saved.diagnosticExpiresAt);
      return !saved.deleted;
    });
  }
  async alarm() {
    await this.storage.transaction(async tx => {
      const saved = await tx.get<Saved>('saved');
      const diagnostic = await tx.get<SessionDiagnostic>('diagnostic');
      const expires = saved?.diagnosticExpiresAt ?? (diagnostic ? diagnostic.updatedAt + DIAGNOSTIC_TTL_MS : 0);
      if (expires <= Date.now()) {
        const keys = [...(await tx.list()).keys()];
        for (let n = 0; n < keys.length; n += 100) await tx.delete(keys.slice(n, n + 100));
        return;
      }
      if (saved && saved.expiresAt <= Date.now()) {
        await deleteParts(tx, saved.parts);
        await tx.put('saved', { ...saved, parts: 0 });
      }
      await tx.setAlarm(saved && saved.expiresAt > Date.now() && !saved.deleted ? saved.expiresAt : expires);
    });
  }
}
