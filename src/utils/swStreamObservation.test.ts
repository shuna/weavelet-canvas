import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

describe('Service Worker recovery observations', () => {
  it('preserves observations and text when both updates run concurrently', async () => {
    const scope = runInNewContext(`${readFileSync('public/sw-stream.js', 'utf8')}\n({ dbPut, dbGet, dbUpdate })`, {
      indexedDB: new IDBFactory(), self: { addEventListener() {} }, Date, Map,
    });
    await scope.dbPut({ requestId: 'concurrent', bufferedText: '', lastProxyEventId: 0 });
    await Promise.all([
      scope.dbUpdate('concurrent', { bufferedText: 'complete answer', lastProxyEventId: 42 }),
      scope.dbUpdate('concurrent', { openRouterObservation: { cost: 0, cachedTokens: 12 } }),
    ]);
    expect(await scope.dbGet('concurrent')).toMatchObject({
      bufferedText: 'complete answer', lastProxyEventId: 42,
      openRouterObservation: { cost: 0, cachedTokens: 12 },
    });
  });
});
