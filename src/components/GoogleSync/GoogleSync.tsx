import { InfoTooltip } from '@components/ConfigMenu/fields';
import SyncDots from './SyncDots';
import { withoutBrowserLocalSettings } from '@store/storage/google/settings';
import { useSyncProgressDisplay } from '@hooks/useSyncProgressDisplay';
import { SyncConflictError, useSyncReview, type Resolution } from '@store/storage/google/conflicts';
import { withSyncProgress, syncPhase, syncStage, phaseProgress } from '@store/storage/google/progress';
import GoogleSyncProgress from './GoogleSyncProgress';
import { createPortal } from 'react-dom';
import React, { useEffect, useRef, useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useTranslation } from 'react-i18next';

import useStore from '@store/store';
import { usesGoogleAuthBackend } from '@api/google-auth';
import useGStore from '@store/cloud-auth-store';
import { showToast } from '@utils/showToast';

import {
  listDriveFiles,
  updateDriveFileName,
  getDriveFileTyped,
  getDriveFolderSize,
  isGoogleAuthError,
  validateGoogleOath2AccessToken,
} from '@api/google-api';
import { getFiles, stateToFile } from '@utils/google-api';
import createGoogleCloudStorage, {
  isGoogleSyncUnlocked, unlockGoogleSync, createEncryptedGoogleSync,
  pullEncryptedGoogleSync, acceptGoogleSyncLocal,
  pauseGoogleSync, queueGoogleSyncSnapshot, restoreGoogleSync, resumeGoogleSync, resolveGoogleSyncConflict,
} from '@store/storage/GoogleCloudStorage';
import { SYNC_FOLDER_TYPE, DEFAULT_SYNC_FOLDER_NAME, nextSyncFolderName } from '@store/storage/google/transport';
import {
  createPersistedChatDataState,
  createLocalStoragePartializedState,
  createPartializedState,
  prepareHydratedState,
  finishHydratedState,
  migratePersistedState,
  needsDataMigration,
  PersistedStoreState,
} from '@store/persistence';
import { saveChatData } from '@store/storage/IndexedDbStorage';
import { STORE_VERSION } from '@store/version';

import GoogleSyncButton, { GoogleSyncButtonHandle } from './GoogleSyncButton';
import PopupModal from '@components/PopupModal';

import GoogleIcon from '@icon/GoogleIcon';
import TickIcon from '@icon/TickIcon';
import RefreshIcon from '@icon/RefreshIcon';
import DownArrow from '@icon/DownArrow';

import { GoogleFileResource, SyncStatus } from '@type/google-api';
import { createJSONStorage } from 'zustand/middleware';
import compressedStorage from '@store/storage/CompressedStorage';

const SILENT_REFRESH_INTERVAL = 3000000; // 50 minutes

type SyncOperation =
  | 'connect'
  | 'reconnect'
  | 'create'
  | 'resume'
  | 'pull'
  | 'disconnect';

type SyncActivity =
  | 'checking'
  | 'syncing'
  | 'downloading'
  | 'authenticating'
  | null;

const formatDateTime = (value: string | undefined, locale?: string): string => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatFileSize = (value: string | undefined, locale?: string): string => {
  if (!value) return 'Unknown';
  const size = Number(value);
  if (!Number.isFinite(size)) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let normalized = size;

  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }

  const digits =
    normalized >= 100 || unitIndex === 0 ? 0 : normalized >= 10 ? 1 : 2;

  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(normalized)} ${units[unitIndex]}`;
};

const actionButtonClass =
  'btn btn-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:saturate-50';

const resolveGoogleSyncErrorStatus = (error: unknown): SyncStatus => {
  if (error instanceof SyncConflictError) useSyncReview.setState({ conflict: true });
  return isGoogleAuthError(error) ? 'unauthenticated' : 'error';
};

const normalizeRemotePersistedState = (
  snapshot: unknown
): {
  state: Partial<PersistedStoreState>;
  version: number;
} => {
  if (!snapshot || typeof snapshot !== 'object') {
    return { state: {}, version: 0 };
  }

  if ('state' in snapshot) {
    const wrapped = snapshot as {
      state?: Partial<PersistedStoreState>;
      version?: number;
    };
    return {
      state: (wrapped.state ?? {}) as Partial<PersistedStoreState>,
      version: wrapped.version ?? 0,
    };
  }

  return {
    state: snapshot as Partial<PersistedStoreState>,
    version: STORE_VERSION,
  };
};

const SyncDirectionOverlay = ({
  direction,
}: {
  direction: 'left' | 'right' | 'up' | 'down';
}) => {
  const rotationClass =
    direction === 'right'
      ? '-rotate-90'
      : direction === 'left'
        ? 'rotate-90'
        : direction === 'up'
          ? 'rotate-180'
          : '';

  const positionClass =
    direction === 'left' || direction === 'right'
      ? 'left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex'
      : 'left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 md:hidden';

  return (
    <div className={`pointer-events-none absolute z-10 ${positionClass}`}>
      <div className='rounded-full border border-gray-300 bg-white/95 px-2 py-1.5 text-emerald-700 shadow-sm dark:border-gray-600 dark:bg-gray-800/95 dark:text-emerald-300'>
        <DownArrow
          className={`m-0 h-7 w-7 ${rotationClass}`}
        />
      </div>
    </div>
  );
};

const SyncDirectionInline = ({
  direction,
}: {
  direction: 'up' | 'down';
}) => {
  const rotationClass = direction === 'up' ? 'rotate-180' : '';

  return (
    <div className='flex justify-center md:hidden'>
      <div className='rounded-full border border-gray-300 bg-white/95 px-2 py-1.5 text-emerald-700 shadow-sm dark:border-gray-600 dark:bg-gray-800/95 dark:text-emerald-300'>
        <DownArrow className={`m-0 h-7 w-7 ${rotationClass}`} />
      </div>
    </div>
  );
};

const GoogleSync = ({ clientId, openOnMount = false, showEntry = true }: { clientId: string; openOnMount?: boolean; showEntry?: boolean }) => {
  const { t } = useTranslation(['drive']);

  const fileId = useGStore((state) => state.fileId);
  const setFileId = useGStore((state) => state.setFileId);
  const googleAccessToken = useGStore((state) => state.googleAccessToken);
  const syncStatus = useGStore((state) => state.syncStatus);
  const cloudSync = useGStore((state) => state.cloudSync);
  const setSyncStatus = useGStore((state) => state.setSyncStatus);
  const syncTargetConfirmed = useGStore((state) => state.syncTargetConfirmed);
  const progress = useSyncProgressDisplay();
  const [bannerTarget, setBannerTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setBannerTarget(document.getElementById('google-sync-banner-overlay'));
  }, []);
  const fraction = phaseProgress(progress);
  const overallPercent = Math.floor(progress.overallProgress * 100);

  const enableCloudPersistence = () => {
    useStore.persist.setOptions({
      storage: createGoogleCloudStorage(),
      partialize: (state) => createPartializedState(state),
    });
  };

  const enableLocalPersistence = () => {
    useStore.persist.setOptions({
      storage: createJSONStorage(() => compressedStorage),
      partialize: (state) => createLocalStoragePartializedState(state),
    });
  };

  const [isModalOpen, setIsModalOpen] = useState<boolean>(openOnMount);
  const [files, setFiles] = useState<GoogleFileResource[]>([]);
  const isSilentRefresh = useRef(false);
  useEffect(() => { if (showEntry && cloudSync) setIsModalOpen(true); }, [showEntry]);

  const initialiseState = async (_googleAccessToken: string, options?: { openModal?: boolean }) => {
    let validated;
    try {
      validated = await validateGoogleOath2AccessToken(_googleAccessToken);
    } catch (error) {
      setSyncStatus('unauthenticated');
      showToast((error as Error).message, 'error');
      return;
    }
    if (validated) {
      try {
        const _files = await getFiles(_googleAccessToken);
        if (_files) {
          setFiles(_files);
          const target = _files.find((file) => file.id === fileId && file.mimeType === SYNC_FOLDER_TYPE)
            ?? (!syncTargetConfirmed ? _files.find((file) => file.mimeType === SYNC_FOLDER_TYPE) : undefined);
          if (target && target.id !== fileId) setFileId(target.id);
          if (syncTargetConfirmed && !target) throw new Error('The previous sync folder is unavailable.');
          if (syncTargetConfirmed && fileId && await restoreGoogleSync(fileId)) {
            enableCloudPersistence();
            await resumeGoogleSync();
            setSyncStatus('synced');
          } else {
            enableLocalPersistence();
            setSyncStatus(target?.mimeType === SYNC_FOLDER_TYPE ? 'locked' : 'synced');
          }
          // Open modal so user can choose Pull/Push direction (skip for silent refresh)
          if (options?.openModal) {
            setIsModalOpen(true);
          }
        }
      } catch (e: unknown) {
        setSyncStatus(resolveGoogleSyncErrorStatus(e));
        showToast((e as Error).message, 'error');
      }
    } else {
      setSyncStatus('unauthenticated');
    }
  };

  useEffect(() => {
    if (googleAccessToken) {
      setSyncStatus('syncing');
      const openModal = !isSilentRefresh.current && (showEntry || openOnMount);
      isSilentRefresh.current = false;
      initialiseState(googleAccessToken, { openModal });
    }
  }, [googleAccessToken]);

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {showEntry && <div
        className='flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-500/10'
        onClick={() => {
          setIsModalOpen(true);
        }}
      >
        <GoogleIcon /> {t('name')}
        {cloudSync && <SyncIcon status={syncStatus} />}
      </div>}
      {bannerTarget && !isModalOpen && (syncStatus === 'syncing' || syncStatus === 'error') && createPortal(
        <button type='button' onClick={() => setIsModalOpen(true)}
          data-google-sync-banner
          className={`absolute inset-x-0 top-0 flex h-6 items-center justify-center gap-1 px-3 text-xs text-white shadow-sm ${syncStatus === 'error' ? 'bg-red-700' : 'bg-emerald-700'}`}
          aria-label={t(syncStatus === 'error' ? 'progress.failed' : 'progress.open') as string}>
          {syncStatus === 'syncing' && progress.active && <span>{t('progress.overall')} {overallPercent}%</span>}
          {t(syncStatus === 'error' ? 'progress.failed' : progress.active ? `progress.${progress.phase}` : 'progress.open')}
          <SyncIcon status={syncStatus} />
          {syncStatus === 'syncing' && progress.active && <>
            <div className='absolute inset-x-0 bottom-0 flex flex-col gap-px'>
              <progress className='h-0.5 w-full accent-emerald-100' max={1} value={progress.overallProgress}
                aria-label={t('progress.overall') as string} />
              <progress className='h-0.5 w-full accent-emerald-300' max={1} value={fraction}
                aria-label={t(`progress.${progress.phase}`) as string} />
            </div>
          </>}
        </button>, bannerTarget
      )}
      <GooglePopup
          isModalOpen={isModalOpen}
          setIsModalOpen={setIsModalOpen}
          files={files}
          setFiles={setFiles}
          isSilentRefresh={isSilentRefresh}
        />
    </GoogleOAuthProvider>
  );
};

const GooglePopup = ({
  isModalOpen,
  setIsModalOpen,
  files,
  setFiles,
  isSilentRefresh,
}: {
  isModalOpen: boolean;
  setIsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  files: GoogleFileResource[];
  setFiles: React.Dispatch<React.SetStateAction<GoogleFileResource[]>>;
  isSilentRefresh: React.MutableRefObject<boolean>;
}) => {
  const { t } = useTranslation(['drive']);

  const syncStatus = useGStore((state) => state.syncStatus);
  const setSyncStatus = useGStore((state) => state.setSyncStatus);
  const cloudSync = useGStore((state) => state.cloudSync);
  const googleAccessToken = useGStore((state) => state.googleAccessToken);
  const setFileId = useGStore((state) => state.setFileId);
  const setSyncTargetConfirmed = useGStore((state) => state.setSyncTargetConfirmed);
  const syncTargetConfirmed = useGStore((state) => state.syncTargetConfirmed);
  const currentFileId = useGStore((state) => state.fileId);
  const [localFileSize] = useState(() => formatFileSize(String(stateToFile().size), navigator.language));

  const syncButtonRef = useRef<GoogleSyncButtonHandle>(null);
  const refreshIntervalRef = useRef<number>();

  const startSilentRefreshInterval = () => {
    if (refreshIntervalRef.current) {
      window.clearInterval(refreshIntervalRef.current);
    }
    refreshIntervalRef.current = window.setInterval(() => {
      syncButtonRef.current?.attemptSilentRefresh();
    }, SILENT_REFRESH_INTERVAL);
  };

  const stopSilentRefreshInterval = () => {
    if (refreshIntervalRef.current) {
      window.clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = undefined;
    }
  };

  useEffect(() => {
    return () => {
      stopSilentRefreshInterval();
    };
  }, []);

  const [_fileId, _setFileId] = useState<string>(
    useGStore.getState().fileId || ''
  );
  const [selectedOperation, setSelectedOperation] =
    useState<SyncOperation>(() => syncTargetConfirmed && currentFileId ? 'resume' : 'connect');
  const [activity, setActivity] = useState<SyncActivity>(null);
  const operationChosen = useRef(false);
  const conflict = useSyncReview(state => state.conflict);
  useEffect(() => { if (conflict) setIsModalOpen(true); }, [conflict]);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [folderNameDraft, setFolderNameDraft] = useState<string>();
  const folderNames = files.filter(file => file.mimeType === SYNC_FOLDER_TYPE).map(file => file.name);
  const folderName = folderNameDraft ?? nextSyncFolderName(DEFAULT_SYNC_FOLDER_NAME, folderNames);
  const proposedFolderName = nextSyncFolderName(folderName, folderNames);
  const snapshot = () => ({ state: createPartializedState(useStore.getState()), version: STORE_VERSION });
  const unlockSelected = async () => {
    await pauseGoogleSync();
    await unlockGoogleSync(operationFileId, passphrase);
    setPassphrase('');
    setConfirmation('');
  };

  const isBusy = syncStatus === 'syncing';

  const setBusyActivity = (nextActivity: Exclude<SyncActivity, null>) => {
    setActivity(nextActivity);
  };

  useEffect(() => {
    if (!_fileId && files.length > 0) {
      _setFileId(files[0].id);
    }
  }, [_fileId, files]);

  useEffect(() => {
    if (!isBusy) {
      setActivity(null);
    }
  }, [isBusy]);

  const selectSyncTarget = (fileId: string) => {
    setFileId(fileId);
    _setFileId(fileId);
  };

  const activateCloudSyncTarget = (fileId: string) => {
    selectSyncTarget(fileId);
    setSyncTargetConfirmed(true);
    useStore.persist.setOptions({
      storage: createGoogleCloudStorage(),
      partialize: (state) => createPartializedState(state),
    });
  };

  const syncFile = files.find((file) => file.id === currentFileId && file.mimeType === SYNC_FOLDER_TYPE)
    ?? files.find((file) => file.mimeType === SYNC_FOLDER_TYPE);
  const syncUnlocked = !!syncFile && isGoogleSyncUnlocked(syncFile.id);
  const automaticSyncActive = syncUnlocked && syncTargetConfirmed && currentFileId === syncFile?.id &&
    (syncStatus === 'synced' || syncStatus === 'syncing');
  const selectedFile = selectedOperation === 'pull' ? files.find((file) => file.id === _fileId) : syncFile;
  const operationFileId = selectedFile?.id ?? '';
  const needsPassphrase = selectedOperation === 'create' ||
    (['resume', 'pull'].includes(selectedOperation) && selectedFile?.mimeType === SYNC_FOLDER_TYPE &&
      !isGoogleSyncUnlocked(operationFileId));
  const inputIssue = selectedOperation === 'create'
    ? !folderName.trim() ? 'guidance.enterFolderName'
      : !passphrase ? 'guidance.enterNewPassphrase'
      : passphrase.length < 12 ? 'guidance.passphraseTooShort'
      : !confirmation ? 'guidance.confirmPassphrase'
      : passphrase !== confirmation ? 'encryption.mismatch' : undefined
    : ['resume', 'pull'].includes(selectedOperation) && !selectedFile
      ? selectedOperation === 'pull' ? 'guidance.selectInput' : 'guidance.createOrRead'
      : needsPassphrase && !passphrase ? 'guidance.enterPassphrase' : undefined;

  // Names are metadata; refreshing them must not pause or change the sync session.
  useEffect(() => {
    if (!isModalOpen || !googleAccessToken) return;
    let cancelled = false;
    const refreshNames = async () => {
      try {
        const result = await listDriveFiles(googleAccessToken);
        if (!cancelled) setFiles(result.files);
      } catch (error) {
        if (!cancelled) showToast((error as Error).message, 'error');
      }
    };
    void refreshNames();
    window.addEventListener('focus', refreshNames);
    return () => { cancelled = true; window.removeEventListener('focus', refreshNames); };
  }, [isModalOpen, googleAccessToken]);

  const refreshCloudFiles = async () => {
    if (!googleAccessToken || isBusy) return;
    try {
      setBusyActivity('checking');
      setSyncStatus('syncing');
      const nextFiles = await getFiles(googleAccessToken);
      if (nextFiles) {
        setFiles(nextFiles);
        if (_fileId && !nextFiles.some((file) => file.id === _fileId)) {
          _setFileId(nextFiles[0]?.id ?? '');
        }
      }
      setSyncStatus('synced');
    } catch (e: unknown) {
      setSyncStatus(resolveGoogleSyncErrorStatus(e));
      showToast((e as Error).message, 'error');
    }
  };

  const applyRemoteToLocal = async () => {
    if (!_fileId || !googleAccessToken) return;
    try {
      setBusyActivity('downloading');
      setSyncStatus('syncing');
      await pauseGoogleSync();
      const encrypted = selectedFile?.mimeType === SYNC_FOLDER_TYPE;
      if (encrypted) await unlockSelected();
      else syncPhase('downloading');
      const remoteStorageValue = await syncStage(0, 2, () => encrypted
        ? pullEncryptedGoogleSync()
        : getDriveFileTyped(_fileId, googleAccessToken));
      await syncStage(1, 2, async () => {
        const normalizedRemote = normalizeRemotePersistedState(remoteStorageValue);
        const remotePersistedState = migratePersistedState(
          normalizedRemote.state,
          normalizedRemote.version
        ) as Partial<PersistedStoreState>;
        const observed = useStore.getState();
        const prepared = await prepareHydratedState(observed, withoutBrowserLocalSettings(remotePersistedState));
        if (observed !== useStore.getState()) throw new Error('Local data changed while preparing the downloaded snapshot. Retry with the latest changes.');
        const hydratedState = finishHydratedState(prepared);

        syncPhase('saving');
        // Keep the local format and persist chat data before publishing the hydrated state.
        await saveChatData(createPersistedChatDataState({ ...useStore.getState(), ...hydratedState }));
        useStore.persist.setOptions({
          storage: createJSONStorage(() => compressedStorage),
          partialize: (state) => createLocalStoragePartializedState(state),
        });
        useStore.setState(hydratedState);
        if (encrypted) {
          await acceptGoogleSyncLocal(snapshot());
          activateCloudSyncTarget(operationFileId);
        } else {
          setSyncTargetConfirmed(false);
        }

        if (needsDataMigration()) {
          useStore.getState().setMigrationUiState({
            visible: true,
            status: 'needs-export-import',
          });
        }
      });
      showToast(t('toast.pull'), 'success');
      setIsModalOpen(false);
      setSyncStatus('synced');
    } catch (e: unknown) {
      setSyncStatus(resolveGoogleSyncErrorStatus(e));
      showToast((e as Error).message, 'error');
    }
  };

  const createSyncFile = async () => {
    if (!googleAccessToken) return;
    try {
      setBusyActivity('syncing');
      setSyncStatus('syncing');
      if (!folderName.trim()) throw new Error(t('guidance.enterFolderName') as string);
      if (passphrase !== confirmation) throw new Error(t('encryption.mismatch') as string);
      const latest = (await listDriveFiles(googleAccessToken)).files;
      const name = nextSyncFolderName(folderNameDraft ?? DEFAULT_SYNC_FOLDER_NAME, latest.filter(file => file.mimeType === SYNC_FOLDER_TYPE).map(file => file.name));
      await pauseGoogleSync();
      const createdFile = await createEncryptedGoogleSync(passphrase, snapshot(), name);
      setFolderNameDraft(undefined);
      setPassphrase('');
      setConfirmation('');
      setFiles(current => current.some(file => file.id === createdFile.id) ? current : [...current, createdFile]);
      activateCloudSyncTarget(createdFile.id);
      await queueGoogleSyncSnapshot(snapshot());
      setSelectedOperation('resume');
      setSyncStatus('synced');
    } catch (e: unknown) {
      setSyncStatus(resolveGoogleSyncErrorStatus(e));
      showToast((e as Error).message, 'error');
    }
  };

  const resolveConflict = async (mode: Resolution) => {
    try {
      setSyncStatus('syncing');
      await withSyncProgress(() => resolveGoogleSyncConflict(mode));
      setSelectedOperation('resume');
      setSyncStatus('synced');
    } catch (error) {
      setSyncStatus(resolveGoogleSyncErrorStatus(error));
      showToast((error as Error).message, 'error');
    }
  };

  const stopSyncing = () => {
    if (isBusy) return;
    syncButtonRef.current?.disconnect();
    setIsModalOpen(false);
  };

  const startSyncing = () => {
    setBusyActivity('authenticating');
    syncButtonRef.current?.connect();
  };

  const needsReconnect = cloudSync && syncStatus === 'unauthenticated';
  const connected = cloudSync && syncStatus !== 'unauthenticated';

  useEffect(() => {
    if (connected && syncTargetConfirmed && googleAccessToken) {
      startSilentRefreshInterval();
      return;
    }
    stopSilentRefreshInterval();
  }, [connected, googleAccessToken, syncTargetConfirmed]);

  const availableOperations: SyncOperation[] = !cloudSync
    ? ['connect']
    : needsReconnect
      ? ['reconnect', 'disconnect']
      : syncTargetConfirmed
        ? ['resume', 'create', 'disconnect']
        : syncFile ? ['pull', 'create', 'disconnect'] : ['create', 'pull', 'disconnect'];

  useEffect(() => {
    if (!operationChosen.current && connected && !isBusy && !syncTargetConfirmed && syncFile && !passphrase && folderNameDraft === undefined) {
      setSelectedOperation('pull');
      return;
    }
    const fallbackOperation = availableOperations[0];
    if (!availableOperations.includes(selectedOperation) && fallbackOperation) {
      setSelectedOperation(fallbackOperation);
    }
  }, [availableOperations, selectedOperation, connected, isBusy, syncTargetConfirmed, syncFile, passphrase, folderNameDraft]);

  const performSelectedOperation = async () => {
    if (isBusy || inputIssue) return;
    if (selectedOperation === 'connect' || selectedOperation === 'reconnect') {
      startSyncing();
      return;
    }
    if (selectedOperation === 'resume') {
      if (automaticSyncActive) return;
      try {
        setSyncStatus('syncing');
        await unlockSelected();
        activateCloudSyncTarget(operationFileId);
        await resumeGoogleSync();
        setSyncStatus('synced');
      } catch (error) {
        setSyncStatus(resolveGoogleSyncErrorStatus(error));
        showToast((error as Error).message, 'error');
      }
      return;
    }
    if (selectedOperation === 'create') {
      await createSyncFile();
      return;
    }
    if (selectedOperation === 'pull') {
      await applyRemoteToLocal();
      return;
    }
    stopSyncing();
  };

  const runSelectedOperation = async () => {
    if (isBusy || inputIssue) return;
    if (['create', 'resume', 'pull'].includes(selectedOperation)) {
      await withSyncProgress(performSelectedOperation);
    } else {
      await performSelectedOperation();
    }
  };

  const operationDescriptionKey = {
    connect: 'actions.connectDescription',
    reconnect: 'actions.reconnectDescription',
    create: 'actions.createDescription',
    resume: automaticSyncActive ? 'guidance.active' : syncUnlocked ? 'actions.retryDescription' : 'actions.resumeDescription',
    pull: 'actions.pullDescription',
    disconnect: 'actions.disconnectDescription',
  } satisfies Record<SyncOperation, string>;

  const operationLabelKey = {
    connect: 'operations.connect',
    reconnect: 'operations.reconnect',
    create: 'operations.create',
    resume: automaticSyncActive ? 'operations.active' : syncUnlocked ? 'operations.retry' : 'operations.resume',
    pull: 'operations.pull',
    disconnect: 'operations.disconnect',
  } satisfies Record<SyncOperation, string>;

  const syncDirection =
    selectedOperation === 'pull'
      ? ({ mobile: 'down', desktop: 'left' } as const)
      : null;

  const readyMessageKey = {
    connect: 'guidance.connect', reconnect: 'guidance.reconnect', create: 'guidance.create',
    resume: automaticSyncActive ? 'guidance.active' : syncUnlocked ? 'guidance.retry' : 'guidance.resume',
    pull: 'guidance.pull', disconnect: 'guidance.disconnect',
  } satisfies Record<SyncOperation, string>;
  const statusMessageKey = isBusy
    ? activity === 'downloading' ? 'status.downloading'
      : activity === 'authenticating' ? 'status.authenticating'
      : activity === 'checking' ? 'status.checking' : 'status.syncing'
    : inputIssue ?? readyMessageKey[selectedOperation];

  if (!isModalOpen) return null;
  return (
    <PopupModal
      title={t('name') as string}
      setIsModalOpen={setIsModalOpen}
      cancelButton={false}
      footerStartContent={
        <div className='flex min-h-[1.5rem] items-center gap-3 text-left'>
          {isBusy ? <SyncIcon status='syncing' /> : <div className='h-4 w-4' />}
          <div id='google-sync-guidance' role='status' className='text-sm text-gray-600 dark:text-gray-300'>
            {syncStatus === 'error' && <p>{t('encryption.failed')}</p>}
            <p>{t(statusMessageKey)}</p>
            {isBusy && <GoogleSyncProgress />}
          </div>
        </div>
      }
      footerEndContent={
        isBusy || conflict || (selectedOperation === 'resume' && automaticSyncActive) ? null : connected ? (
          <button
            type='button'
            className={actionButtonClass}
            onClick={runSelectedOperation}
            aria-describedby='google-sync-guidance'
            disabled={isBusy || !!inputIssue}
          >
            {t(operationLabelKey[selectedOperation])}
          </button>
        ) : (
          <button
            type='button'
            className={actionButtonClass}
            onClick={runSelectedOperation}
            disabled={isBusy}
          >
            {t(operationLabelKey[selectedOperation])}
          </button>
        )
      }
    >
      <div
        aria-busy={isBusy}
        className='border-b border-gray-200 p-6 text-sm text-gray-900 dark:border-gray-600 dark:text-gray-300 flex flex-col items-center gap-4 text-center'
      >
        <div className='w-full max-w-2xl rounded-lg border border-gray-300 bg-gray-50/90 px-4 py-4 text-left dark:border-gray-600 dark:bg-gray-800/50'>
          <p className='text-sm text-gray-900 dark:text-gray-100'>{t('tagline')}</p>
          <p className='mt-3 text-xs text-gray-700 dark:text-gray-300'>{t('privacy')}</p>
          <p className='mt-3 text-xs text-gray-700 dark:text-gray-300'>{t(usesGoogleAuthBackend ? 'backendNotice' : 'notice')}</p>
        </div>
        <GoogleSyncButton
          ref={syncButtonRef}
          showDisconnectButton={false}
          showDisconnectNotice={false}
          loginHandler={() => {}}
          onBeforeSilentRefresh={() => {
            isSilentRefresh.current = true;
            setBusyActivity('checking');
          }}
          onSilentRefreshFail={() => {
            if (refreshIntervalRef.current) {
              window.clearInterval(refreshIntervalRef.current);
            }
            setIsModalOpen(true);
          }}
        />
        {conflict && <div role='alert' className='w-full max-w-2xl rounded border border-amber-500 p-4 text-left'>
          <p>{t('conflict.description')}</p>
          <div className='mt-3 flex flex-wrap gap-2'>
            {(['merge', 'local', 'cloud'] as const).map(mode => <button key={mode} type='button'
              className={actionButtonClass} disabled={isBusy} onClick={() => void resolveConflict(mode)}>
              {t(`conflict.${mode}`)}
            </button>)}
          </div>
        </div>}
        <div className='w-full max-w-2xl rounded-lg border border-gray-200 bg-white/80 p-4 text-left dark:border-gray-600 dark:bg-gray-800/40'>
          <div className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
            {t('labels.operation')}
          </div>
          <select
            className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-gray-500 dark:bg-gray-700 dark:text-white'
            value={selectedOperation}
            aria-label={t('labels.operation') as string}
            onChange={(e) => { operationChosen.current = true; setSelectedOperation(e.target.value as SyncOperation); }}
            disabled={isBusy || conflict}
          >
            {availableOperations.map((operation) => (
              <option key={operation} value={operation}>
                {t(operation === 'pull' ? 'operations.selectInput' : operationLabelKey[operation])}
              </option>
            ))}
          </select>
          <div className='mt-3 min-h-[5.5rem] rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300'>
            {t(operationDescriptionKey[selectedOperation])}
          </div>
        </div>
        {connected && selectedOperation === 'create' && <div className='w-full max-w-2xl text-left'>
          <div className='flex items-center'><label className='text-sm' htmlFor='google-sync-folder-name'>{t('labels.folderName')}</label><InfoTooltip text={t('encryption.folderNameHelp')} /></div>
          <input id='google-sync-folder-name' list='google-sync-folder-names' type='text'
            className='mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2'
            value={folderName} onChange={event => setFolderNameDraft(event.target.value)} disabled={isBusy} />
          <datalist id='google-sync-folder-names'>
            {[...new Set([DEFAULT_SYNC_FOLDER_NAME, ...folderNames].map(name => nextSyncFolderName(name, folderNames)))].map(name => <option key={name} value={name} />)}
          </datalist>
          {folderName.trim() && proposedFolderName !== folderName.trim() && <p className='mt-1 text-xs'>{t('encryption.folderNameAdjusted', { name: proposedFolderName })}</p>}
        </div>}
        {connected && needsPassphrase && (
          <div className='w-full max-w-2xl text-left'>
            <label className='block text-sm' htmlFor='google-sync-passphrase'>{t('encryption.passphrase')}</label>
            <input id='google-sync-passphrase' type='password' autoComplete='off' aria-describedby='google-sync-guidance'
              className='mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2'
              value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={isBusy} />
            {selectedOperation === 'create' && (
              <>
                <label className='mt-3 block text-sm' htmlFor='google-sync-confirm'>{t('encryption.confirm')}</label>
                <input id='google-sync-confirm' type='password' autoComplete='off' aria-describedby='google-sync-guidance'
                  className='mt-1 w-full rounded border border-gray-300 bg-transparent px-3 py-2'
                  value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={isBusy} />
              </>
            )}
            <p className='mt-2 text-xs'>{t('encryption.help')}</p>
          </div>
        )}
        {connected && (
          <div className='flex w-full max-w-2xl flex-col gap-4 items-stretch text-left'>
            <div className='relative flex flex-col gap-3 md:grid md:grid-cols-2'>
              {syncDirection && <SyncDirectionOverlay direction={syncDirection.desktop} />}
              <div className='order-3 rounded-lg border border-gray-200 bg-gray-100/80 p-3 md:order-1 dark:border-gray-600 dark:bg-gray-800/60'>
                <div className='mb-2 flex h-8 items-center'>
                  <div className='text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                    {t('labels.localState')}
                  </div>
                </div>
                <div className='text-sm text-gray-900 dark:text-gray-100'>
                  {t('labels.fileSize')}:{' '}
                  {localFileSize === 'Unknown' ? t('labels.unknownSize') : localFileSize}
                </div>
                <div className='text-xs text-gray-600 dark:text-gray-400 break-all'>
                  {t('labels.syncingFolderId')}:{' '}
                  {syncTargetConfirmed && currentFileId ? currentFileId : '-'}
                </div>
              </div>
              <div className='order-1 rounded-lg border border-gray-200 bg-gray-100/80 p-3 md:order-2 dark:border-gray-600 dark:bg-gray-800/60'>
                <div className='mb-2 flex items-center justify-between gap-3'>
                  <div className='text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                    {t(selectedOperation === 'pull' ? 'labels.inputSource' : 'labels.currentTarget')}
                  </div>
                  <button
                    type='button'
                    className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white/80 text-gray-600 transition-colors hover:border-emerald-400 hover:text-emerald-600 disabled:pointer-events-none disabled:opacity-50 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300'
                    onClick={() => {
                      void refreshCloudFiles();
                    }}
                    disabled={isBusy || !googleAccessToken}
                    aria-label={t('button.refreshFiles') as string}
                    title={t('button.refreshFiles') as string}
                  >
                    {isBusy ? <SyncDots label={t('progress.preparing')} /> : <RefreshIcon />}
                  </button>
                </div>
                <div className='max-h-72 overflow-y-auto pr-1'>
                  {(selectedOperation === 'pull' ? files : syncFile ? [syncFile] : []).length === 0 ? (
                    <div className='rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400'>
                      {t('labels.noFiles')}
                    </div>
                  ) : (
                    (selectedOperation === 'pull' ? files : syncFile ? [syncFile] : []).map((file) => (
                      <FileSelector
                        key={file.id}
                        file={file}
                        selected={selectedOperation === 'pull' && _fileId === file.id}
                        current={syncTargetConfirmed && currentFileId === file.id}
                        syncing={isBusy}
                        selectable={selectedOperation === 'pull'}
                        onSelect={_setFileId}
                        onRename={(id, name) => setFiles(current => current.map(file => file.id === id ? { ...file, name } : file))}
                      />
                    ))
                  )}
                </div>
              </div>
              {syncDirection && (
                <div className='order-2 md:hidden'>
                  <SyncDirectionInline direction={syncDirection.mobile} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PopupModal>
  );
};

const FileSelector = ({ file, selected, current, syncing, selectable, onSelect, onRename }: {
  file: GoogleFileResource;
  selected: boolean;
  current: boolean;
  syncing: boolean;
  selectable: boolean;
  onSelect: React.Dispatch<React.SetStateAction<string>>;
  onRename: (id: string, name: string) => void;
}) => {
  const { t, i18n } = useTranslation(['drive']);
  const googleAccessToken = useGStore((state) => state.googleAccessToken);
  const isFolder = file.mimeType === SYNC_FOLDER_TYPE;
  const [nameDraft, setNameDraft] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const rename = async () => {
    if (!googleAccessToken || !nameDraft?.trim()) return;
    const name = nameDraft.trim();
    setRenaming(true);
    try {
      await updateDriveFileName(name, file.id, googleAccessToken);
      onRename(file.id, name); setNameDraft(undefined);
    } catch (error) { showToast((error as Error).message, 'error'); }
    finally { setRenaming(false); }
  };
  const [folderSize, setFolderSize] = useState<string>();
  const [sizeError, setSizeError] = useState<string>();
  useEffect(() => {
    if (!isFolder || !googleAccessToken || syncing) return;
    let cancelled = false;
    setFolderSize(undefined);
    setSizeError(undefined);
    getDriveFolderSize(file.id, googleAccessToken).then(
      size => { if (!cancelled) setFolderSize(size); },
      error => { if (!cancelled) setSizeError((error as Error).message); }
    );
    return () => { cancelled = true; };
  }, [file.id, file, isFolder, googleAccessToken, syncing]);
  const size = formatFileSize(isFolder ? folderSize : file.size, i18n.language);
  const updated = formatDateTime(file.modifiedTime, i18n.language);
  return (
    <div className='mb-2 flex w-full min-w-0 items-start gap-3 rounded-lg border border-gray-300 px-3 py-3 text-sm dark:border-gray-600'>
      {selectable && <input type='radio' name='google-sync-input' aria-label={file.name}
        checked={selected} disabled={syncing} onChange={() => onSelect(file.id)} />}
      <div className='min-w-0 flex-1 break-all text-xs'>
        {current && <div className='font-semibold'>{t('labels.currentTarget')}</div>}
        {isFolder ? <div>
          <label htmlFor={`sync-folder-name-${file.id}`}>{t('labels.folderName')}</label>
          <div className='mt-1 flex gap-2'>
            <input id={`sync-folder-name-${file.id}`} type='text' className='min-w-0 flex-1 rounded border border-gray-300 bg-transparent px-2 py-1'
              value={nameDraft ?? file.name} onChange={event => setNameDraft(event.target.value)} disabled={renaming} />
            <button type='button' onClick={() => void rename()} disabled={renaming || !nameDraft?.trim() || nameDraft.trim() === file.name}
              className='shrink-0 rounded border px-2 disabled:opacity-40'>{t('button.renameFolder')}</button>
          </div>
          {nameDraft !== undefined && nameDraft !== file.name && <div className='mt-1'>{t('labels.currentFolderName', { name: file.name })}</div>}
        </div> : <div>{t('labels.fileName')}: {file.name}</div>}
        <div>{t(isFolder ? 'labels.folderSize' : 'labels.fileSize')}: {size === 'Unknown' ? t('labels.unknownSize') : size}</div>
        {sizeError && <div role='status' className='text-amber-700 dark:text-amber-400'>{sizeError}</div>}
        <div>{t('labels.updatedAt')}: {updated === 'Unknown' ? t('labels.unknownDate') : updated}</div>
        {file.mimeType !== SYNC_FOLDER_TYPE && <p className='mt-2'>{t('encryption.legacy')}</p>}
      </div>
    </div>
  );
};

const SyncIcon = ({ status }: { status: SyncStatus }) => {
  const statusToIcon = {
    locked: <span aria-label='Locked'>🔒</span>,
    error: <span aria-label='Sync failed'>!</span>,
    unauthenticated: (
      <div className='bg-red-600/80 rounded-full w-4 h-4 text-xs flex justify-center items-center'>
        !
      </div>
    ),
    syncing: (
      <SyncDots label='同期中' />
    ),
    synced: (
      <div className='bg-gray-600/80 rounded-full p-1'>
        <TickIcon className='h-2 w-2' />
      </div>
    ),
  };
  return statusToIcon[status] || null;
};

export default GoogleSync;
