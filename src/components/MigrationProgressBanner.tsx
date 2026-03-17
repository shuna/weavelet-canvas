import React from 'react';
import useStore, { type StoreState } from '@store/store';
import { resumeLargeMigrationInBackground } from '@hooks/useAppBootstrap';

const MigrationProgressBanner = () => {
  const migrationUiState = useStore((s: StoreState) => s.migrationUiState);

  if (!migrationUiState || !migrationUiState.visible) return null;

  const { status, progress, migratedChats, totalChats, lastError } = migrationUiState;

  const handleRetry = () => {
    useStore.getState().setMigrationUiState({
      ...migrationUiState,
      status: 'running',
      resumable: false,
      lastError: undefined,
    });
    resumeLargeMigrationInBackground(useStore.getState());
  };

  const percent = Math.round(progress * 100);

  return (
    <div className='fixed top-0 left-0 right-0 z-[998] bg-blue-600 text-white px-4 py-3 shadow-md'>
      {status === 'running' && (
        <div className='flex items-center gap-4'>
          <div className='flex-1'>
            <div className='text-sm font-medium mb-1'>
              保存データを移行中です（{migratedChats} / {totalChats} チャット）
            </div>
            <div className='w-full bg-blue-800 rounded-full h-2'>
              <div
                className='bg-white rounded-full h-2 transition-all duration-300'
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <div className='text-sm font-mono whitespace-nowrap'>{percent}%</div>
        </div>
      )}

      {status === 'finalizing' && (
        <div className='text-sm font-medium'>
          移行の最終処理中です。まもなく完了します。
        </div>
      )}

      {status === 'failed' && (
        <div className='flex items-center justify-between gap-4 bg-red-600 -mx-4 -my-3 px-4 py-3'>
          <div className='flex-1 text-sm'>
            <strong>移行エラー</strong>
            {' '}保存データの移行を再開できませんでした。データは保持されています。
            {lastError && (
              <span className='block mt-1 text-xs opacity-80'>{lastError}</span>
            )}
          </div>
          <button
            onClick={handleRetry}
            className='px-3 py-1 text-sm bg-red-800 text-white rounded hover:bg-red-900 whitespace-nowrap'
          >
            再試行
          </button>
        </div>
      )}
    </div>
  );
};

export default MigrationProgressBanner;
