import type { ProxyStatus } from '../../proxy-worker/src/diagnostics';

type Request = { path: string; query: [string, string][]; method: 'GET' | 'DELETE'; timeout: number };
export type ProxyDeletionState = { deleted: number; failed: number; before?: number; cursor: string | null };
type StatusQuery = { sessionIds?: string[]; all?: boolean; cursor?: string };
const validCursor = (value: unknown): value is string => typeof value === 'string' && /^session:[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const counters = (value: Record<string, unknown>, keys: string[]) => keys.every(key => value[key] === undefined || (Number.isSafeInteger(value[key]) && (value[key] as number) >= 0));
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => value[key] === undefined || typeof value[key] === 'string');

function validStatusSession(value: unknown): boolean {
  if (!object(value) || typeof value.sessionId !== 'string' || !object(value.cache) || typeof value.cache.state !== 'string') return false;
  if (!counters(value.cache, ['firstEventId', 'lastEventId', 'expiresAt', 'updatedAt']) || !strings(value.cache, ['terminal', 'capability', 'reason'])) return false;
  return value.local == null || (object(value.local)
    && strings(value.local, ['sessionId', 'phase', 'reason', 'disconnectReason'])
    && counters(value.local, ['startedAt', 'updatedAt', 'lastEventId', 'firstEventId', 'lastChunkAt', 'disconnectedAt', 'lastClientWriteAt', 'receivedBytes', 'bufferedBytes', 'cacheWrites', 'cacheFailures', 'lastCacheWriteAt']));
}

export function proxyStatusRequest(input: StatusQuery): Request {
  const query: [string, string][] = (input.sessionIds ?? []).map(id => ['sessionId', id]);
  if (input.all) query.push(['all', '1']);
  if (input.cursor) query.push(['cursor', input.cursor]);
  return { path: '/api/status', query, method: 'GET', timeout: 8 };
}

export function readProxyStatus(httpStatus: number, body: unknown, all = false): ProxyStatus {
  if (httpStatus < 200 || httpStatus >= 300) throw new Error(httpStatus === 401 ? '認証に失敗しました。プロキシの認証トークンを確認してください。'
    : httpStatus === 403 ? '全実行環境の記録を見るには、プロキシの認証設定と認証トークンが必要です。'
    : httpStatus === 404 || httpStatus === 501 ? 'このプロキシは状態APIに対応していません。Workerを更新してください。' : `状態の取得に失敗しました（HTTP ${httpStatus}）`);
  const deletion = object(body) ? body.storageDeletion : undefined;
  if (!object(body) || !Array.isArray(body.sessions) || !body.sessions.every(validStatusSession)
    || !strings(body, ['version', 'colo', 'instanceId', 'scope']) || !counters(body, ['checkedAt', 'unavailableSessions'])
    || (body.limits !== undefined && (!object(body.limits) || !counters(body.limits, ['cacheBytes', 'retentionMs', 'idleTimeoutMs'])))
    || (deletion !== undefined && (!object(deletion) || ['individual', 'all'].some(key => deletion[key] !== undefined && typeof deletion[key] !== 'boolean')))
    || (body.nextCursor !== undefined && body.nextCursor !== null && !validCursor(body.nextCursor)))
    throw new Error('プロキシからの状態応答が不正です');
  const status = body as unknown as ProxyStatus;
  if (all && status.scope !== 'all-sessions') throw new Error('このプロキシは全実行環境の一覧に対応していません。Workerを更新してください。');
  return status;
}

export function proxyDeleteRequest(sessionId?: string, state?: ProxyDeletionState): Request {
  const query: [string, string][] = [];
  if (state?.before !== undefined) query.push(['before', String(state.before)]);
  if (state?.cursor) query.push(['cursor', state.cursor]);
  return { path: `/api/storage${sessionId === undefined ? '' : `/${encodeURIComponent(sessionId)}`}`,
    query: sessionId === undefined ? query : [], method: 'DELETE', timeout: 30 };
}

export function readProxyDeletion(httpStatus: number, body: unknown, sessionId?: string, state?: ProxyDeletionState): ProxyDeletionState {
  if (httpStatus < 200 || httpStatus >= 300) throw new Error(httpStatus === 401 || httpStatus === 403 ? '削除する権限がありません。プロキシの認証トークンを確認してください。'
    : httpStatus === 404 || httpStatus === 501 ? 'このプロキシは保存データの削除に対応していません。' : `保存データの削除に失敗しました（HTTP ${httpStatus}）。再度実行してください。`);
  const result = body as { deleted: number | boolean; failed: number; before: number; cursor: string | null } | null;
  if (sessionId !== undefined) {
    if (result?.deleted !== true) throw new Error('削除結果を確認できませんでした');
    return { deleted: 1, failed: 0, cursor: null };
  }
  if (!result || !Number.isSafeInteger(result.deleted) || (result.deleted as number) < 0 || !Number.isSafeInteger(result.failed) || result.failed < 0 || !Number.isSafeInteger(result.before)
    || (state?.before !== undefined && state.before !== result.before)
    || (result.cursor !== null && (!validCursor(result.cursor) || (state?.cursor != null && result.cursor <= state.cursor))))
    throw new Error('プロキシからの削除応答が不正です');
  const next = { deleted: (state?.deleted ?? 0) + (result.deleted as number), failed: (state?.failed ?? 0) + result.failed,
    before: result.before, cursor: result.cursor };
  if (!Number.isSafeInteger(next.deleted) || !Number.isSafeInteger(next.failed)) throw new Error('プロキシからの削除応答が不正です');
  if (!next.cursor && next.failed) throw new Error(`${next.deleted}件を削除しましたが、${next.failed}件の削除に失敗しました。再度実行してください。`);
  return next;
}

export const proxyStatusLabels: { phase: Record<string, string>; cache: Record<string, string>; reason: Record<string, string> } = {
  phase: { headers: '応答ヘッダー待ち', streaming: '受信中', disconnected: 'クライアント切断', complete: '完了', interrupted: '中断', failed: '失敗', acknowledged: '受信確認済み' },
  cache: { available: '保存あり', missing: '保存データなし', expired: '期限切れ', error: '保存状態を取得できません', acknowledged: '受信確認後に削除済み', 'not-saved': '受付済み・応答の保存なし', 'not-recorded': 'サーバー記録なし' },
  reason: {
    'runtime-ended': '中継の実行が終了しています。保存済みの範囲まで確認できます',
    'upstream-idle-timeout': '上流APIから45秒間データが届きませんでした',
    'upstream-eof-before-done': '上流APIが完了通知より前に接続を終了しました',
    'upstream-connection-error': '上流APIへの接続に失敗しました',
    'upstream-read-error': '上流APIからの読み取り中にエラーが発生しました',
    'header-timeout': '上流APIの初回応答が45秒以内に届きませんでした',
    'client-disconnected': '端末との接続が切れました',
    'client-write-timeout': '端末への送信が15秒間進みませんでした',
    'cancel-requested': '停止要求を受信しました', complete: '完了', aborted: '中止',
  },
};

export function proxyRecoveryHasGap(cursor: number, cache: ProxyStatus['sessions'][number]['cache']): boolean {
  return cache.state === 'available' && (cursor < (cache.firstEventId ?? 1) - 1
    || (cache.terminal !== 'streaming' && cursor > (cache.lastEventId ?? 0)));
}

type Operation = ({ operation: 'statusRequest' } & StatusQuery)
  | { operation: 'statusResponse'; httpStatus: number; body?: unknown; all?: boolean }
  | { operation: 'deleteRequest'; sessionId?: string; state?: ProxyDeletionState }
  | { operation: 'deleteResponse'; httpStatus: number; body?: unknown; sessionId?: string; state?: ProxyDeletionState }
  | { operation: 'recoveryGaps'; records: { sessionId: string; cursor: number }[]; sessions: ProxyStatus['sessions'] }
  | { operation: 'labels' };

export function proxyManagement(json: string): string {
  const input = JSON.parse(json) as Operation;
  switch (input.operation) {
    case 'statusRequest': return JSON.stringify(proxyStatusRequest(input));
    case 'statusResponse': return JSON.stringify(readProxyStatus(input.httpStatus, input.body, input.all));
    case 'deleteRequest': return JSON.stringify(proxyDeleteRequest(input.sessionId, input.state));
    case 'deleteResponse': return JSON.stringify(readProxyDeletion(input.httpStatus, input.body, input.sessionId, input.state));
    case 'labels': return JSON.stringify(proxyStatusLabels);
    case 'recoveryGaps': return JSON.stringify(Object.fromEntries(input.sessions.map(session => {
      const record = input.records.find(record => record.sessionId === session.sessionId);
      return [session.sessionId, !!record && proxyRecoveryHasGap(record.cursor, session.cache)];
    })));
    default: throw new Error('Unknown proxy management operation');
  }
}
