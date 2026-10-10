import React, { useEffect, useRef, useState } from 'react';
import useCloudAuthStore from '@store/cloud-auth-store';
import { useSyncReview, SyncConflictError, type Resolution } from '@store/storage/google/conflicts';
import { connectFileSystemSync, reconnectFileSystemSync, disconnectFileSystemSync, resolveFileSystemConflict } from '@store/storage/FileSystemSync';

const FileSystemSync = () => {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const cloudSync = useCloudAuthStore(state => state.cloudSync);
  const syncStatus = useCloudAuthStore(state => state.syncStatus);
  const label = useCloudAuthStore(state => state.remoteTargetLabel);
  const conflict = useSyncReview(state => state.conflict);
  const [mode, setMode] = useState<'create' | 'open'>('create');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = typeof window.showDirectoryPicker === 'function';
  const run = async (work: () => Promise<void>) => {
    const provider = useCloudAuthStore.getState().provider;
    setBusy(true); setError('');
    try { await work(); setPassword(''); setConfirmation(''); }
    catch (failure) {
      if (!mounted.current || useCloudAuthStore.getState().provider !== provider) return;
      if (failure instanceof Error && failure.name === 'AbortError') return;
      setError(failure instanceof Error ? failure.message : String(failure));
      useCloudAuthStore.getState().setProviderSession('filesystem', { syncStatus: failure instanceof Error && failure.name === 'NotAllowedError' ? 'unauthenticated' : 'error' });
      useSyncReview.setState({ conflict: failure instanceof SyncConflictError });
    }
    finally { setBusy(false); }
  };
  const select = () => run(async () => {
    if (!window.showDirectoryPicker) throw new Error('デスクトップのChromeまたはEdgeを使用してください。');
    // Invoke the picker directly from the button action, before asynchronous work.
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!mounted.current || useCloudAuthStore.getState().provider !== 'filesystem') return;
    await connectFileSystemSync(handle, password, mode === 'create');
  });
  const disabled = busy || syncStatus === 'syncing';
  const resolve = (resolution: Resolution) => run(() => resolveFileSystemConflict(resolution));
  return (
    <div className='flex flex-col gap-2 text-xs text-gray-600 dark:text-gray-300'>
      <div className='font-medium'>フォルダー同期</div>
      <p>OneDriveやGoogle Driveなどの同期フォルダー内に専用フォルダーを用意してください。内容はパスフレーズで暗号化して保存します。</p>
      <p>クラウドへの転送はデスクトップの同期アプリが行います。履歴は自動削除しないため、使用量は増えます。</p>
      {!supported && <p role='status'>フォルダー選択にはデスクトップのChromeまたはEdgeが必要です。</p>}
      {cloudSync ? (
        <>
          <div>保存先: {label ?? '保存先を再選択してください'}</div>
          <div role='status'>{{ synced: 'フォルダーへ保存済み', syncing: 'フォルダーを同期中', locked: 'パスフレーズで再開してください', unauthenticated: '保存先へのアクセス許可が必要です', error: '同期を停止しています' }[syncStatus]}</div>
          {syncStatus !== 'synced' && (
            <label>同期用パスフレーズ
              <input aria-label='フォルダー同期パスフレーズ' type='password' autoComplete='off' value={password} onChange={event => setPassword(event.target.value)} className='input w-full' disabled={disabled} />
            </label>
          )}
          {conflict ? (
            <>
              <p>変更が競合しています。統合を選ぶと、両方の内容を残して解決します。</p>
              <button className='btn btn-small btn-primary' disabled={disabled} onClick={() => resolve('merge')}>両方の変更を統合</button>
              <button className='btn btn-small btn-neutral' disabled={disabled} onClick={() => resolve('local')}>このブラウザーの内容を採用</button>
              <button className='btn btn-small btn-neutral' disabled={disabled} onClick={() => resolve('cloud')}>フォルダーの内容を採用</button>
            </>
          ) : (
            <button className='btn btn-small btn-primary' disabled={disabled || !supported} onClick={() => run(() => reconnectFileSystemSync(password))}>{syncStatus === 'synced' ? '今すぐ同期' : 'アクセスを許可して再開'}</button>
          )}
          <button className='btn btn-small btn-neutral' disabled={disabled} onClick={() => run(disconnectFileSystemSync)}>フォルダー同期を解除</button>
          <p>解除してもフォルダーのファイルと、このブラウザーの会話は残ります。</p>
        </>
      ) : (
        <>
          <label>操作
            <select aria-label='フォルダー同期の操作' value={mode} onChange={event => { setMode(event.target.value as 'create' | 'open'); setReplaceConfirmed(false); }} className='input w-full' disabled={disabled}>
              <option value='create'>空のフォルダーに新規保存</option>
              <option value='open'>既存の同期フォルダーから読み込む</option>
            </select>
          </label>
          <label>同期用パスフレーズ（12文字以上）
            <input aria-label='フォルダー同期パスフレーズ' type='password' autoComplete='new-password' value={password} onChange={event => setPassword(event.target.value)} className='input w-full' disabled={disabled} />
          </label>
          {mode === 'create' ? (
            <label>パスフレーズの確認
              <input aria-label='フォルダー同期パスフレーズの確認' type='password' autoComplete='new-password' value={confirmation} onChange={event => setConfirmation(event.target.value)} className='input w-full' disabled={disabled} />
            </label>
          ) : (
            <label className='flex gap-2 items-start'>
              <input type='checkbox' checked={replaceConfirmed} onChange={event => setReplaceConfirmed(event.target.checked)} disabled={disabled} />
              現在の会話と設定を、選択したフォルダーの内容で置き換えることを確認しました。
            </label>
          )}
          <button className='btn btn-small btn-primary' disabled={disabled || !supported || password.length < 12 || (mode === 'create' ? password !== confirmation : !replaceConfirmed)} onClick={select}>{mode === 'create' ? '保存先フォルダーを選択' : '読み込むフォルダーを選択'}</button>
        </>
      )}
      {error && <p role='alert' className='text-red-600 dark:text-red-400'>{error}</p>}
    </div>
  );
};
export default FileSystemSync;
