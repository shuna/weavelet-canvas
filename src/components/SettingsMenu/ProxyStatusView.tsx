import React, { useEffect, useState } from 'react';
import PopupModal from '@components/PopupModal';
import useStore from '@store/store';
import { fetchProxyStatus, type ProxyConfig, type ProxyStatus } from '@utils/proxyClient';
import { getAllPending, type StreamRecord } from '@utils/streamDb';
import { recoverPending } from '@hooks/useStreamRecovery';
import { resolveRecoveryTarget } from '@hooks/streamRecoveryHelpers';

const phaseLabels: Record<string, string> = { headers: '応答ヘッダー待ち', streaming: '受信中', disconnected: 'クライアント切断', complete: '完了', interrupted: '中断', failed: '失敗', acknowledged: '受信確認済み' };
const cacheLabels: Record<string, string> = { available: '保存あり', missing: '保存データなし', expired: '期限切れ', error: '保存状態を取得できません' };
const reasonLabels: Record<string, string> = {
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [manualId, setManualId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [refresh, setRefresh] = useState(0);
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
    {error && <p role='alert' className='text-red-600 dark:text-red-400'>{error}</p>}
    {status && <>
      <div className='rounded border p-3 dark:border-gray-600 space-y-1'>
        <p>Worker {status.version} · 接続拠点 {status.colo} · 実行環境 <span className='font-mono'>{status.instanceId.slice(0, 8)}</span></p>
        <p>保存上限 {(status.limits.cacheBytes / 1048576).toFixed(0)} MiB · 保存期限 {status.limits.retentionMs / 60000}分 · 上流の無通信期限 {status.limits.idleTimeoutMs / 1000}秒</p>
        {status.recentSessionsVisible === false && <p className='text-xs text-amber-600 dark:text-amber-400'>プロキシ認証が未設定のため、セッションIDの一覧公開を無効にしています。既知のIDだけを照会します。</p>}
        <p className='text-xs text-gray-500 dark:text-gray-400'>このブラウザの直近20件と、接続した実行環境の履歴を表示します。別の拠点・実行環境の履歴は一覧に含まれません。「保存データなし」は削除・期限切れ・別拠点でも発生します。</p>
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
              <span>中継: {session.local ? phaseLabels[session.local.phase] : 'この実行環境では確認できません'}</span>
              <span>復旧データ: {cacheLabels[session.cache.state]}</span>
              <span>最終保存状態: {session.cache.terminal === 'streaming' ? '受信中の記録（現在の実行は未確認）' : session.cache.terminal ? phaseLabels[session.cache.terminal] : '不明'}</span>
            </div>
            <dl className='grid grid-cols-2 md:grid-cols-4 gap-2 text-xs'>
              <div><dt>端末の受信位置</dt><dd>{record ? cursor : 'この端末に記録なし'}</dd></div>
              <div><dt>保存イベント範囲</dt><dd>{session.cache.firstEventId ?? '—'} ～ {session.cache.lastEventId ?? '—'}</dd></div>
              <div><dt>最終受信 / 保存</dt><dd>{time(session.local?.lastChunkAt)} / {time(session.cache.updatedAt)}</dd></div>
              <div><dt>保存期限</dt><dd>{time(session.cache.expiresAt)}</dd></div>
              {session.local && <><div><dt>受信 / 保持バイト</dt><dd>{session.local.receivedBytes.toLocaleString()} / {session.local.bufferedBytes.toLocaleString()}</dd></div><div><dt>保存試行 / 失敗</dt><dd>{session.local.cacheWrites + session.local.cacheFailures} / {session.local.cacheFailures}</dd></div><div><dt>終了・切断理由</dt><dd>{reason(session.local.reason ?? session.cache.reason)}</dd></div></>}
            </dl>
            {!session.local && session.cache.reason && <p className='text-xs'>保存時の終了・切断理由: {reason(session.cache.reason)}</p>}
            {record && <p className='text-xs'>端末の記録: {record.status} · リクエストID <span className='font-mono'>{record.requestId}</span>{record.error ? ` · ${record.error}` : ''}</p>}
            {gap && <p className='text-amber-600 dark:text-amber-400'>端末の受信位置と保存範囲が一致しないため、欠落なく復旧することはできません。</p>}
            {record && !target && <p className='text-amber-600 dark:text-amber-400'>保存先のバブルまたは内容が変更されています。自動で上書きしません。</p>}
            {record && !live && target && <button type='button' className='btn btn-neutral' disabled={!!recovering || !!gap} onClick={async () => {
              setRecovering(record.requestId);
              try { await recoverPending({ manual: true, chatId: record.chatId, nodeId: record.nodeId, requestId: record.requestId }); }
              catch (e) { setError(e instanceof Error ? e.message : '復旧処理に失敗しました'); }
              finally { setRecovering(undefined); setRefresh(n => n + 1); }
            }}>{recovering === record.requestId ? '復旧中…' : 'このリクエストを復旧'}</button>}
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
