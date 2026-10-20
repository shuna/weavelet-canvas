import { expect, it } from 'vitest';
import { proxyManagement, readProxyDeletion, readProxyStatus } from './proxyManagement';

const cursor = 'session:' + 'a'.repeat(64);
const call = (input: object) => JSON.parse(proxyManagement(JSON.stringify(input)));

it('shares relative requests without credentials or runtime URL APIs', () => {
  expect(call({ operation: 'statusRequest', sessionIds: ['chat:id/?'], all: true, cursor })).toEqual({
    path: '/api/status', query: [['sessionId', 'chat:id/?'], ['all', '1'], ['cursor', cursor]], method: 'GET', timeout: 8,
  });
  expect(call({ operation: 'deleteRequest', sessionId: 'chat:id/?' })).toEqual({
    path: '/api/storage/chat%3Aid%2F%3F', query: [], method: 'DELETE', timeout: 30,
  });
});

it('preserves unknown diagnostic fields while checking all-scope and cursor compatibility', () => {
  const body = { scope: 'all-sessions', sessions: [], nextCursor: cursor, future: { retained: true } };
  expect(call({ operation: 'statusResponse', httpStatus: 200, body, all: true })).toEqual(body);
  for (const invalid of [null, {}, { sessions: [], nextCursor: 'bad' }])
    expect(() => readProxyStatus(200, invalid)).toThrow('不正');
  expect(() => readProxyStatus(200, { sessions: [], scope: 'current-isolate' }, true)).toThrow('全実行環境');
});

it('keeps the first deletion cutoff and strictly advancing cursor across every page', () => {
  const first = call({ operation: 'deleteResponse', httpStatus: 200, body: { deleted: 20, failed: 0, before: 100, cursor } });
  expect(call({ operation: 'deleteRequest', state: first }).query).toEqual([['before', '100'], ['cursor', cursor]]);
  for (const body of [{ deleted: 1, failed: 0, before: 101, cursor: null },
    { deleted: 1, failed: 0, before: 100, cursor },
    { deleted: 1, failed: 0, before: 100, cursor: 'session:' + '0'.repeat(64) }])
    expect(() => readProxyDeletion(200, body, undefined, first)).toThrow('不正');
  expect(call({ operation: 'deleteResponse', httpStatus: 200, state: first,
    body: { deleted: 2, failed: 0, before: 100, cursor: null } })).toEqual({ deleted: 22, failed: 0, before: 100, cursor: null });
  expect(() => readProxyDeletion(200, { deleted: 2, failed: 1, before: 100, cursor: null }, undefined, first)).toThrow('22件');
  expect(() => readProxyDeletion(200, { deleted: Number.MAX_SAFE_INTEGER, failed: 0, before: 100, cursor: null }, undefined, first)).toThrow('不正');
});

it('rejects malformed diagnostics before Web or native renders them without losing unknown fields', () => {
  const session = { sessionId: 'known', local: null, cache: { state: 'available' }, future: { kept: true } };
  const body = { sessions: [session], limits: { cacheBytes: 1024 }, storageDeletion: { individual: true } };
  expect(readProxyStatus(200, body)).toBe(body);
  for (const invalid of [null, { ...session, cache: null }, { ...session, local: { receivedBytes: 1e100 } },
    { ...session, cache: { state: 'available', expiresAt: -1 } }])
    expect(() => readProxyStatus(200, { sessions: [invalid] })).toThrow('不正');
  for (const invalid of [{ ...body, unavailableSessions: Infinity }, { ...body, limits: { cacheBytes: '1024' } },
    { ...body, storageDeletion: { all: 'true' } }])
    expect(() => readProxyStatus(200, invalid)).toThrow('不正');
});

it('does not interpret private server error bodies or report an unconfirmed deletion as success', () => {
  for (const operation of ['statusResponse', 'deleteResponse']) {
    expect(() => call({ operation, httpStatus: 403, body: { secret: 'FAKE private body' } })).toThrow(/認証/);
    try { call({ operation, httpStatus: 403, body: { secret: 'FAKE private body' } }); }
    catch (error) { expect(String(error)).not.toContain('FAKE private body'); }
  }
  expect(() => readProxyDeletion(200, { deleted: false }, 'id')).toThrow('確認');
  expect(call({ operation: 'deleteResponse', httpStatus: 200, body: { deleted: true }, sessionId: 'id' }))
    .toEqual({ deleted: 1, failed: 0, cursor: null });
  expect(call({ operation: 'labels' }).phase.complete).toBe('完了');
});

it('uses the same saved-range gap rule for Web rows and the native journal projection', () => {
  const rows = [
    { sessionId: 'missing-first', cursor: 1, cache: { state: 'available', firstEventId: 3, lastEventId: 5, terminal: 'complete' } },
    { sessionId: 'ahead', cursor: 6, cache: { state: 'available', firstEventId: 1, lastEventId: 5, terminal: 'complete' } },
    { sessionId: 'streaming', cursor: 6, cache: { state: 'available', firstEventId: 1, lastEventId: 5, terminal: 'streaming' } },
    { sessionId: 'next', cursor: 2, cache: { state: 'available', firstEventId: 3, lastEventId: 5, terminal: 'complete' } },
    { sessionId: 'absent', cursor: 10, cache: { state: 'missing' } },
  ];
  const input = { operation: 'recoveryGaps', records: rows.map(({ sessionId, cursor }) => ({ sessionId, cursor })),
    sessions: [...rows, { sessionId: 'remote-only', cache: { state: 'available', firstEventId: 4 } }] };
  expect(call(input)).toEqual({ 'missing-first': true, ahead: true, streaming: false, next: false, absent: false, 'remote-only': false });
});
