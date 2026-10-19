import React, { useEffect, useState } from 'react';
import PopupModal from '@components/PopupModal';
import useStore from '@store/store';
import { deleteProxyStorage, fetchProxyStatus, type ProxyConfig, type ProxyStatus } from '@utils/proxyClient';
import { getAllPending, type StreamRecord } from '@utils/streamDb';
import { recoverPending } from '@hooks/useStreamRecovery';
import { resolveRecoveryTarget } from '@hooks/streamRecoveryHelpers';

const phaseLabels: Record<string, string> = { headers: '応答ヘッダー待ち', streaming: '受信中', disconnected: 'クライアント切断', complete: '完了', interrupted: '中断', failed: '失敗', acknowledged: '受信確認済み' };
const cacheLabels: Record<string, string> = { available: '保存あり', missing: '保存データなし', expired: '期限切れ', error: '保存状態を取得できません', acknowledged: '受信確認後に削除済み', 'not-saved': '受付済み・応答の保存なし', 'not-recorded': 'サーバー記録なし' };
const reasonLabels: Record<string, string> = {
  'runtime-ended': '中継の実行が終了しています。保存済みの範囲まで確認できます',
  'upstream-idle-timeout': '上流APIから45秒間データが届きませんでした',
  'upstream-eof-before-done': '上流APIが完了通知より前に接続を終了しました',
  'upstream-connection-error': '上流APIへの接続に失敗しました',
  'upstream-read-error': '上流APIからの読み取り中にエラーが発生しました',
  'header-timeout': '上流APIの初回応答が45秒以内に届きませんでした',
  'client-disconnected': '端末との接続が切れました',
  'client-write-timeout': '端末への送信が15秒間進みませんでした',
  'cancel-requested': '停止要求を受信しました', complete: '完了', aborted: '中止',
};
const reason = (value?: string) => value ? `${reasonLabels[value] ?? value}（${value}）` : '—';
const time = (value?: number) => value ? new Date(value).toLocaleTimeString() : '—';

export function ProxyStatusView({ config }: { config: ProxyConfig }) {
  const [status, setStatus] = useState<ProxyStatus>();
  const [records, setRecords] = useState<StreamRecord[]>([]);
  const [actionError, setActionError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [manualId, setManualId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<string>();
  const [notice, setNotice] = useState('');
  const [recovering, setRecovering] = useState<string>();
  useEffect(() => {
    let active = true;
    let fetching = false;
    let abort: AbortController | undefined;
    setStatus(undefined);
    const load = async () => {
      if (fetching) return;
      fetching = true;
      setLoading(true);
      abort = new AbortController();
      const timer = setTimeout(() => abort?.abort(), 8_000);
      try {
        const pending = (await getAllPending()).filter(r => !!r.proxySessionId).sort((a, b) => b.createdAt - a.createdAt);
        const ids = [...new Set([...(selectedId ? [selectedId] : []), ...pending.map(r => r.proxySessionId!)])].slice(0, 20);
        const result = await fetchProxyStatus(config, ids, abort.signal);
        if (active) { setRecords(pending); setStatus(result); setError(''); }
      } catch (e) {
        if (active) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : '状態の取得がタイムアウトしました');
      } finally {
        clearTimeout(timer);
        fetching = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const poll = setInterval(() => { void load(); }, 5_000);
    return () => { active = false; abort?.abort(); clearInterval(poll); };
  }, [config.endpoint, config.authToken, selectedId, refresh]);

  const removeStorage = async (sessionId?: string) => {
    const description = sessionId === undefined
      ? 'このプロキシの全端末の復旧データと診断履歴を削除します。削除開始時点の中継も停止します。表示されていない保存データも対象です。'
      : `このリクエストの復旧データと診断履歴を削除し、中継中の場合は停止します。\n${sessionId}`;
    if (!window.confirm(`${description}\n端末に保存済みの会話は残ります。プロキシからは復旧できなくなります。削除しますか？`)) return;
    setDeleting(sessionId ?? '*'); setNotice(''); setActionError('');
    try {
      const count = await deleteProxyStorage(config, sessionId);
      setNotice(sessionId === undefined ? `${count}件の保存データを削除しました。` : 'このリクエストの保存データを削除しました。');
    } catch (e) { setActionError(e instanceof Error ? e.message : '保存データの削除に失敗しました'); }
    finally { setDeleting(undefined); setRefresh(n => n + 1); }
  };

  return <div className='p-5 space-y-4 text-sm text-gray-900 dark:text-gray-100 w-[90vw] max-w-5xl'>
    <div className='flex flex-wrap items-center gap-3'>
      <span className='font-mono break-all'>{config.endpoint}</span>
      <button type='button' className='btn btn-neutral' disabled={loading} onClick={() => setRefresh(n => n + 1)}>更新</button>
      <span className='text-xs text-gray-500 dark:text-gray-400'>{loading ? '確認中…' : `5秒ごとに更新 · 最終確認 ${time(status?.checkedAt)}`}</span>
    </div>
    <form className='flex gap-2' onSubmit={event => { event.preventDefault(); setSelectedId(manualId.trim()); setRefresh(n => n + 1); }}>
      <input className='flex-1 min-w-0 rounded border p-2 dark:bg-gray-800 dark:border-gray-600' aria-label='調べるプロキシセッションID' placeholder='セッションIDを指定して照会' value={manualId} onChange={event => setManualId(event.target.value)} />
      <button className='btn btn-neutral' type='submit'>照会</button>
    </form>
    {notice && <p role='status'>{notice}</p>}
    {(actionError || error) && <p role='alert' className='text-red-600 dark:text-red-400'>{actionError || error}</p>}
    {status && <>
      <div className='rounded border p-3 dark:border-gray-600 space-y-1'>
        {status.storageDeletion?.all && <button type='button' className='btn btn-neutral text-red-600 dark:text-red-400' disabled={!!deleting || !!recovering} onClick={() => { void removeStorage(); }}>{deleting === '*' ? '全保存データを削除中…' : 'プロキシの全保存データを削除'}</button>}
        {status.storageDeletion?.individual && !status.storageDeletion.all && <p className='text-xs'>全削除にはプロキシ側の認証設定が必要です。</p>}
        <p>Worker {status.version} · 接続拠点 {status.colo} · 実行環境 <span className='font-mono'>{status.instanceId.slice(0, 8)}</span></p>
        <p>保存上限 {(status.limits.cacheBytes / 1048576).toFixed(0)} MiB · 保存期限 {status.limits.retentionMs / 60000}分 · 上流の無通信期限 {status.limits.idleTimeoutMs / 1000}秒</p>
        {status.scope !== 'durable-session' && status.recentSessionsVisible === false && <p className='text-xs text-amber-600 dark:text-amber-400'>プロキシ認証が未設定のため、セッションIDの一覧公開を無効にしています。既知のIDだけを照会します。</p>}
        <p className='text-xs text-gray-500 dark:text-gray-400'>{status.scope === 'durable-session' ? 'このブラウザの直近20件をIDごとの永続保存先に照会します。別拠点からも同じ記録を確認できます。応答は最終保存から5分、診断履歴は24時間保持します。更新前のリクエストの履歴は引き継げません。' : 'このブラウザの直近20件と、接続した実行環境の履歴を表示します。別の拠点・実行環境の履歴は一覧に含まれません。「保存データなし」は削除・期限切れ・別拠点でも発生します。'}</p>
      </div>
      {!status.sessions.length && <p>照会できるリクエストはありません。別デバイスのセッションIDも指定できます。</p>}
      <div className='space-y-3'>
        {status.sessions.map(session => {
          const record = records.find(r => r.proxySessionId === session.sessionId);
          const cursor = record?.lastProxyEventId ?? 0;
          const gap = record && session.cache.state === 'available' && (cursor < (session.cache.firstEventId ?? 1) - 1 || (session.cache.terminal !== 'streaming' && cursor > (session.cache.lastEventId ?? 0)));
          const state = useStore.getState();
          const live = record && Object.values(state.generatingSessions).some(s => s.chatId === record.chatId && s.targetNodeId === record.nodeId);
          const target = record && resolveRecoveryTarget(state.chats, state.contentStore, record);
          return <section className='rounded border p-3 dark:border-gray-600 space-y-2' key={session.sessionId}>
            <div className='font-mono text-xs break-all select-text'>{session.sessionId}</div>
            <div className='flex flex-wrap gap-x-5 gap-y-1'>
              <span>中継: {session.local ? phaseLabels[session.local.phase] : status.scope === 'durable-session' ? '記録なし（更新前・別URL・24時間経過など）' : 'この実行環境では確認できません'}</span>
              <span>復旧データ: {cacheLabels[session.cache.state]}</span>
              <span>最終保存状態: {session.cache.terminal === 'streaming' ? '受信中の記録（現在の実行は未確認）' : session.cache.terminal ? phaseLabels[session.cache.terminal] : '不明'}</span>
            </div>
            <dl className='grid grid-cols-2 md:grid-cols-4 gap-2 text-xs'>
              <div><dt>端末の受信位置</dt><dd>{record ? cursor : 'この端末に記録なし'}</dd></div>
              <div><dt>保存イベント範囲</dt><dd>{session.cache.firstEventId ?? '—'} ～ {session.cache.lastEventId ?? '—'}</dd></div>
              <div><dt>最終受信 / 保存</dt><dd>{time(session.local?.lastChunkAt)} / {time(session.cache.updatedAt)}</dd></div>
              <div><dt>保存期限</dt><dd>{time(session.cache.expiresAt)}</dd></div>
              {session.local && <><div><dt>端末向け最終送信</dt><dd>{time(session.local.lastClientWriteAt)}</dd></div><div><dt>端末への切断検出</dt><dd>{time(session.local.disconnectedAt)} · {reason(session.local.disconnectReason)}</dd></div><div><dt>受信 / 保持バイト</dt><dd>{session.local.receivedBytes.toLocaleString()} / {session.local.bufferedBytes.toLocaleString()}</dd></div><div><dt>保存試行 / 失敗</dt><dd>{session.local.cacheWrites + session.local.cacheFailures} / {session.local.cacheFailures}</dd></div><div><dt>終了・切断理由</dt><dd>{reason(session.local.reason ?? session.cache.reason)}</dd></div></>}
            </dl>
            {!session.local && session.cache.reason && <p className='text-xs'>保存時の終了・切断理由: {reason(session.cache.reason)}</p>}
            {session.cache.state === 'not-recorded' && <p className='text-xs text-amber-600 dark:text-amber-400'>サーバーに受付記録がありません。この表示だけでは保存失敗と判断できません。WorkerのバージョンとプロキシURLも確認してください。</p>}
            {record && <p className='text-xs'>端末の記録: {record.status} · リクエストID <span className='font-mono'>{record.requestId}</span>{record.error ? ` · ${record.error}` : ''}</p>}
            {gap && <p className='text-amber-600 dark:text-amber-400'>端末の受信位置と保存範囲が一致しないため、欠落なく復旧することはできません。</p>}
            {record && !target && <p className='text-amber-600 dark:text-amber-400'>保存先のバブルまたは内容が変更されています。自動で上書きしません。</p>}
            {record && !live && target && <button type='button' className='btn btn-neutral' disabled={!!recovering || !!deleting || !!gap} onClick={async () => {
              setRecovering(record.requestId);
              try { await recoverPending({ manual: true, chatId: record.chatId, nodeId: record.nodeId, requestId: record.requestId }); }
              catch (e) { setError(e instanceof Error ? e.message : '復旧処理に失敗しました'); }
              finally { setRecovering(undefined); setRefresh(n => n + 1); }
            }}>{recovering === record.requestId ? '復旧中…' : 'このリクエストを復旧'}</button>}
            {status.storageDeletion?.individual && <button type='button' className='btn btn-neutral text-red-600 dark:text-red-400' disabled={!!deleting || !!recovering} onClick={() => { void removeStorage(session.sessionId); }}>{deleting === session.sessionId ? '削除中…' : 'この保存データを削除'}</button>}
          </section>;
        })}
      </div>
    </>}
  </div>;
}

export default function ProxyStatusButton({ config }: { config: ProxyConfig }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type='button' className='btn btn-neutral' disabled={!config.endpoint.trim()} onClick={() => setOpen(true)}>プロキシの状態を確認</button>
    {open && <PopupModal title='プロキシの状態' setIsModalOpen={setOpen} maxWidth='max-w-5xl' cancelButton={false}>
      <ProxyStatusView config={config} />
    </PopupModal>}
  </>;
}
