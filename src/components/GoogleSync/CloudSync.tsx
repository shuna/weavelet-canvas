import React, { useEffect, useState } from 'react';

import useCloudAuthStore from '@store/cloud-auth-store';
import type { CloudSyncProvider as CloudSyncProviderType } from '@store/cloud-auth-types';
import GoogleSync, { SyncIcon } from './GoogleSync';
import CloudKitSync from './CloudKitSync';
import RefreshIcon from '@icon/RefreshIcon';
import GoogleDriveIcon from '@icon/GoogleDriveIcon';
import CloudIcon from '@icon/CloudIcon';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined;

const providerLabels: Record<CloudSyncProviderType, string> = {
  google: 'Google Drive',
  cloudkit: 'iCloud',
};

const CloudSync = () => {
  const selectedProvider = useCloudAuthStore((s) => s.provider);
  const cloudSync = useCloudAuthStore((s) => s.cloudSync);
  const syncStatus = useCloudAuthStore((s) => s.syncStatus);
  const setProvider = useCloudAuthStore((s) => s.setProvider);

  const [returningFromGoogle] = useState(() => new URLSearchParams(location.search).get('google-sync') === 'return');
  const [expanded, setExpanded] = useState(returningFromGoogle);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(returningFromGoogle);
  useEffect(() => {
    if (!returningFromGoogle) return;
    const url = new URL(location.href);
    url.searchParams.delete('google-sync');
    history.replaceState(history.state, '', url);
  }, [returningFromGoogle]);
  // Track when user picked a provider to set up (before cloudSync is true)
  const [setupProvider, setSetupProvider] = useState<CloudSyncProviderType | null>(returningFromGoogle ? 'google' : null);

  const isActive = cloudSync;
  // Show the provider panel when active OR when user is in setup flow
  const showingProvider = isActive ? selectedProvider : setupProvider;

  const showGoogleStatus = isActive && selectedProvider === 'google' && !expanded && !!googleClientId;
  const googleStatusLabel = {
    synced: '同期済み',
    syncing: '同期中',
    locked: 'ロック中',
    unauthenticated: '認証が必要',
    error: '同期失敗',
  }[syncStatus];

  return (
    <>
      <div className='flex items-center rounded-md text-sm text-gray-700 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-500/10'>
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left'
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <RefreshIcon className='w-4 h-4 shrink-0' />
          <span className='min-w-0 truncate' title='クラウド同期'>クラウド同期</span>
          {isActive && !expanded && !showGoogleStatus && (
            <span className='ml-auto shrink-0' role='img' aria-label={providerLabels[selectedProvider]} title={providerLabels[selectedProvider]}>
              {selectedProvider === 'google' ? <GoogleDriveIcon className='w-4 h-4' /> : <CloudIcon className='w-4 h-4' />}
            </span>
          )}
        </button>
        {showGoogleStatus && (
          <button
            type='button'
            className='flex h-9 min-w-[36px] shrink-0 items-center justify-center rounded-md px-2'
            aria-label={`Google Drive: ${googleStatusLabel}。同期の詳細を開く`}
            title={`Google Drive: ${googleStatusLabel}。同期の詳細を開く`}
            onClick={() => setIsGoogleModalOpen(true)}
          >
            <SyncIcon status={syncStatus} />
          </button>
        )}
      </div>
      {showingProvider === 'google' && googleClientId && (
        <GoogleSync clientId={googleClientId} openOnMount={returningFromGoogle} showEntry={expanded}
          isModalOpen={isGoogleModalOpen} setIsModalOpen={setIsGoogleModalOpen} />
      )}

      {expanded && (
        <div className='px-2 pb-2'>
          {showingProvider ? (
            /* --- Provider panel (active or setting up) --- */
            <>
              {showingProvider === 'google' ? (
                googleClientId ? (
                  null
                ) : (
                  <div className='text-xs text-amber-600 dark:text-amber-400'>
                    VITE_GOOGLE_CLIENT_ID 未設定
                  </div>
                )
              ) : (
                <CloudKitSync />
              )}
              {!isActive && (
                <button
                  type='button'
                  disabled={syncStatus === 'syncing'}
                  onClick={() => setSetupProvider(null)}
                  className='mt-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                >
                  ← 戻る
                </button>
              )}
            </>
          ) : (
            /* --- No sync: show provider choices --- */
            <div className='flex flex-col gap-1'>
              <button
                type='button'
                onClick={() => {
                  setProvider('google');
                  setSetupProvider('google');
                }}
                className='flex items-center gap-3 rounded px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50'
              >
                <GoogleDriveIcon className='w-4 h-4 shrink-0' />
                <span className='min-w-0 truncate' title='Google Drive で同期'>Google Drive で同期</span>
              </button>
              <button
                type='button'
                onClick={() => {
                  setProvider('cloudkit');
                  setSetupProvider('cloudkit');
                }}
                className='flex items-center gap-3 rounded px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50'
              >
                <CloudIcon className='w-4 h-4 shrink-0' />
                <span className='min-w-0 truncate' title='iCloud で同期'>iCloud で同期</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default CloudSync;
