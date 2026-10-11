import React, { useEffect, useState } from 'react';

import useCloudAuthStore from '@store/cloud-auth-store';
import type { CloudSyncProvider as CloudSyncProviderType } from '@store/cloud-auth-types';
import GoogleSync from './GoogleSync';
import CloudKitSync from './CloudKitSync';
import FileSystemSync from './FileSystemSync';
import RefreshIcon from '@icon/RefreshIcon';
import GoogleDriveIcon from '@icon/GoogleDriveIcon';
import CloudIcon from '@icon/CloudIcon';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined;

const providerLabels: Record<CloudSyncProviderType, string> = {
  google: 'Google Drive',
  cloudkit: 'iCloud',
  filesystem: 'フォルダー',
};

const CloudSync = () => {
  const selectedProvider = useCloudAuthStore((s) => s.provider);
  const cloudSync = useCloudAuthStore((s) => s.cloudSync);
  const syncStatus = useCloudAuthStore((s) => s.syncStatus);
  const setProvider = useCloudAuthStore((s) => s.setProvider);

  const [returningFromGoogle] = useState(() => new URLSearchParams(location.search).get('google-sync') === 'return');
  const [expanded, setExpanded] = useState(returningFromGoogle);
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

  return (
    <>
      <a
        className='flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-500/10'
        onClick={() => {
          setExpanded((v) => !v);
        }}
      >
        <RefreshIcon className='w-4 h-4 shrink-0' />
        <span className='min-w-0 truncate' title='クラウド同期'>クラウド同期</span>
        {isActive && (
          <span className='ml-auto shrink-0' role='img' aria-label={providerLabels[selectedProvider]} title={providerLabels[selectedProvider]}>
            {selectedProvider === 'google' ? <GoogleDriveIcon className='w-4 h-4' /> : selectedProvider === 'cloudkit' ? <CloudIcon className='w-4 h-4' /> : providerLabels[selectedProvider]}
          </span>
        )}
      </a>
      {showingProvider === 'google' && googleClientId && (
        <GoogleSync clientId={googleClientId} openOnMount={returningFromGoogle} showEntry={expanded} />
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
              ) : showingProvider === 'filesystem' ? (
                <FileSystemSync />
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
              <button type='button' onClick={() => { setProvider('filesystem'); setSetupProvider('filesystem'); }}
                className='rounded px-2 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50'>
                フォルダーで同期
              </button>
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
