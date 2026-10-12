import React, { useState } from 'react';
import useStore, { type StoreState } from '@store/store';
import { clearNeedsDataMigration } from '@store/persistence';
import {
  buildRecoveryExportPayload,
  getRecoveryExportFilename,
} from '@store/recoveryExport';
import downloadFile from '@utils/downloadFile';
import { loadLegacyRemoteSnapshots } from '@store/storage/IndexedDbStorage';
import { STORE_VERSION } from '@store/version';
import { notifyStorageError } from '@store/storage/storageErrors';

const MigrationProgressBanner = () => {
  const migrationUiState = useStore((s: StoreState) => s.migrationUiState);
  const [exporting, setExporting] = useState(false);

  if (!migrationUiState || !migrationUiState.visible) return null;

  const handleDismiss = () => {
    clearNeedsDataMigration();
    useStore.getState().setMigrationUiState(null);
  };

  const recoveryRequired = migrationUiState.status === 'storage-recovery-required';
  const legacySnapshots = migrationUiState.legacyRemoteSnapshots ?? [];
  const remoteMigration = legacySnapshots.length > 0;
  const recoveryDetails = migrationUiState.details?.filter(Boolean).slice(0, 3) ?? [];

  const handleRecoveryExport = async () => {
    setExporting(true);
    try {
      const payload = await buildRecoveryExportPayload();
      downloadFile(payload, `${getRecoveryExportFilename()}.json`);
    } catch (error) {
      notifyStorageError(error);
    } finally {
      setExporting(false);
    }
  };

  const handleLegacyExport = async (id: string) => {
    setExporting(true);
    try {
      const record = (await loadLegacyRemoteSnapshots()).find(record => record.id === id);
      if (!record) throw new Error('保存対象の同期データが見つかりません');
      downloadFile(record.snapshot, `weavelet-remote-v${record.snapshot.version}-${record.id}.json`);
    } catch (error) {
      notifyStorageError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className='fixed top-0 left-0 right-0 z-[1000] bg-yellow-600 text-white px-4 py-3 shadow-md'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div className='flex-1 text-sm'>
          <strong>
            {recoveryRequired
              ? '会話データの安全な読み込みに失敗しました'
              : remoteMigration ? '同期データの移行が必要です' : 'データ形式が古い可能性があります'}
          </strong>
          {' '}
          {recoveryRequired
            ? '既存データを保護するため保存と圧縮を停止しています。復旧用データを保存してください。'
            : remoteMigration
              ? '同期データは現在の会話へ適用せず保管しています。元のデータを書き出して保存してください。'
              : '問題がある場合は、設定からデータをエクスポートし、再インポートしてください。'}
          {legacySnapshots.some(record => record.version < STORE_VERSION) && (
            <div className='mt-1 text-xs'>保存した旧版のJSONを設定のデータインポートで選択してください。取り込みと保存が成功するまで元のデータを保管します。</div>
          )}
          {legacySnapshots.some(record => record.version > STORE_VERSION) && (
            <div className='mt-1 text-xs'>新しい版のデータは、この版では取り込めません。書き出したデータを対応する版で開いてください。</div>
          )}
          {recoveryRequired && recoveryDetails.length > 0 && (
            <div className='mt-1 text-xs opacity-90 break-all'>
              詳細: {recoveryDetails.join(' / ')}
            </div>
          )}
        </div>
        {recoveryRequired ? (
          <button
            onClick={handleRecoveryExport}
            disabled={exporting}
            className='px-3 py-1 text-sm bg-yellow-800 text-white rounded hover:bg-yellow-900 whitespace-nowrap disabled:opacity-60'
          >
            {exporting ? '保存中…' : '復旧用データを保存'}
          </button>
        ) : !remoteMigration ? (
          <button
            onClick={handleDismiss}
            className='px-3 py-1 text-sm bg-yellow-800 text-white rounded hover:bg-yellow-900 whitespace-nowrap'
          >
            閉じる
          </button>
        ) : null}
        {legacySnapshots.map((record, index) => (
          <button key={record.id} onClick={() => handleLegacyExport(record.id)} disabled={exporting}
            className='px-3 py-1 text-sm bg-yellow-800 text-white rounded hover:bg-yellow-900 whitespace-nowrap disabled:opacity-60'>
            {exporting ? '保存中…' : `同期データ${index + 1}を保存 (v${record.version})`}
          </button>
        ))}
      </div>
    </div>
  );
};

export default MigrationProgressBanner;
