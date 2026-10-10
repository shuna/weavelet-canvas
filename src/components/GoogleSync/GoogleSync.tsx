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
import { resolveContentText } from '@utils/contentStore';

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
  pauseGoogleSync, queueGoogleSyncSnapshot, restoreGoogleSync, resumeGoogleSync, resolveGoogleSyncConflict, getGoogleSyncCloudOverview,
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
import { summarizeSyncSnapshot, type SyncOverview } from '@store/storage/google/overview';
import type { Snapshot } from '@store/storage/google/records';
import ConflictDetails from './ConflictDetails';

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
  if (error instanceof SyncConflictError) useSyncReview.setState({ conflict: true, conflictKeys: error.keys, cloudOverview: null, cloudReview: null });
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
        if (!(e instanceof SyncConflictError)) showToast((e as Error).message, 'error');
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
  const conflictKeys = useSyncReview(state => state.conflictKeys);
  const cloudOverview = useSyncReview(state => state.cloudOverview);
  const overviewState = useStore(state => conflict && isModalOpen ? createPartializedState(state) : null);
  const [localOverview, setLocalOverview] = useState<SyncOverview>();
  const [localOverviewFailed, setLocalOverviewFailed] = useState(false);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const [reviewTab, setReviewTab] = useState<'overview' | 'targets'>('overview');
  const [detail, setDetail] = useState<{ key: string; snapshot: Snapshot } | null>(null);
  useEffect(() => { setDetail(null); }, [conflict, conflictKeys, isModalOpen]);
  useEffect(() => { setReviewTab('overview'); }, [conflict]);
  useEffect(() => {
    if (!overviewState) return;
    let cancelled = false;
    setLocalOverview(undefined);
    setLocalOverviewFailed(false);
    void summarizeSyncSnapshot(structuredClone({ state: overviewState, version: STORE_VERSION })).then(
      overview => { if (!cancelled) setLocalOverview(overview); },
      () => { if (!cancelled) setLocalOverviewFailed(true); }
    );
    return () => { cancelled = true; };
  }, [conflict, isModalOpen, overviewState, overviewAttempt]);
  useEffect(() => {
    if (!conflict || !isModalOpen || cloudOverview) return;
    let cancelled = false;
    setOverviewFailed(false);
    void getGoogleSyncCloudOverview().then(
      overview => { if (!cancelled) useSyncReview.setState({ cloudOverview: overview }); },
      () => { if (!cancelled) setOverviewFailed(true); }
    );
    return () => { cancelled = true; };
  }, [conflict, conflictKeys, isModalOpen, cloudOverview, overviewAttempt]);
  const conflictTargetsRef = useRef<HTMLDivElement>(null);
  const [hasMoreTargets, setHasMoreTargets] = useState(false);
  const updateMoreTargets = () => {
    const list = conflictTargetsRef.current;
    setHasMoreTargets(!!list && list.scrollHeight - list.scrollTop > list.clientHeight + 1);
  };
  useEffect(() => {
    const list = conflictTargetsRef.current;
    if (!list) return;
    const observer = new ResizeObserver(updateMoreTargets);
    observer.observe(list);
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    updateMoreTargets();
    return () => observer.disconnect();
  }, [conflict, conflictKeys, isModalOpen, reviewTab]);
  const [selectedResolution, setSelectedResolution] = useState<Resolution>();
  useEffect(() => { setSelectedResolution(undefined); }, [conflict, conflictKeys]);
  const chats = useStore(state => state.chats);
  const folders = useStore(state => state.folders);
  const contentStore = useStore(state => state.contentStore);
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
      if (!(e instanceof SyncConflictError)) showToast((e as Error).message, 'error');
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
      if (!(e instanceof SyncConflictError)) showToast((e as Error).message, 'error');
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
      if (!(e instanceof SyncConflictError)) showToast((e as Error).message, 'error');
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
      if (!(error instanceof SyncConflictError)) showToast((error as Error).message, 'error');
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
        if (!(error instanceof SyncConflictError)) showToast((error as Error).message, 'error');
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
      title={<>
        <span>{t(detail ? 'details.title' : 'detailsTitle')}</span>
        {!detail && <span className='mt-1 block text-xs font-normal text-gray-500 dark:text-gray-300'>{t('syncDestination')}</span>}
      </>}
      headerBottomContent={detail && <button type='button' autoFocus onClick={() => { setDetail(null); requestAnimationFrame(() => conflictTargetsRef.current?.focus()); }} className='inline-flex items-center gap-2 rounded border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:border-gray-500 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500'><span aria-hidden='true'>←</span>{t('details.back')}</button>}
      setIsModalOpen={setIsModalOpen}
      cancelButton={false}
      maxWidth={conflict ? 'w-full max-w-2xl' : undefined}
      disableClose={!!detail}
      scrollBody={!conflict}
      footerStartContent={
        detail ? null : <div className='flex flex-col items-start gap-2 text-left'>
          {(!conflict || isBusy) && <div className='flex min-h-[1.5rem] items-center gap-3'>
          {isBusy && <SyncIcon status='syncing' />}
          <div id='google-sync-guidance' role='status' className='text-sm text-gray-600 dark:text-gray-300'>
            {syncStatus === 'error' && !conflict && <p>{t('encryption.failed')}</p>}
            <p>{t(statusMessageKey)}</p>
            {isBusy && <GoogleSyncProgress />}
          </div>
          </div>}
          <span className='inline-flex items-center gap-1 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300'>
            <InfoTooltip text={<><p>{t(usesGoogleAuthBackend ? 'backendNotice' : 'notice')}</p><p className='mt-2'>{t('encryption.help')}</p></>} />
            {t('encryption.about')}
          </span>
        </div>
      }
      footerEndContent={
        detail || isBusy ? null : conflict ? (
          <button type='button' className={actionButtonClass} disabled={!selectedResolution}
            onClick={() => { if (selectedResolution) void resolveConflict(selectedResolution); }}>
            {t('conflict.apply')}
          </button>
        ) : (selectedOperation === 'resume' && automaticSyncActive) ? null : connected ? (
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
        className={`border-b border-gray-200 p-6 text-sm text-gray-900 dark:border-gray-600 dark:text-gray-300 flex flex-col items-center gap-4 text-center ${conflict ? 'min-h-0 min-w-0 w-full' : ''}`}
      >
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
        {detail && <ConflictDetails key={detail.key} conflictKey={detail.key} localSnapshot={detail.snapshot} />}
        {conflict && <section className={`${detail ? 'hidden' : 'flex'} min-h-0 w-full max-w-2xl flex-col text-left`} aria-labelledby='google-sync-conflict-title'>
          <h4 id='google-sync-conflict-title' className='shrink-0 font-semibold text-amber-800 dark:text-amber-300' role='alert'>{t('conflict.title')}</h4>
          <p className='mt-1 shrink-0 text-sm text-gray-600 dark:text-gray-300'>{t('conflict.guidance')}</p>
          <div className='mt-6 flex shrink-0 items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300'><span>{t('conflict.contentsTitle')}</span><span className='flex-1 border-t border-gray-300 dark:border-gray-600' /></div>
          <div className='flex min-h-0 flex-col pt-3'>
            <div className='flex shrink-0 items-center justify-between gap-2'>
              <div role='tablist' aria-label={t('overview.review') as string} className='flex min-w-0 flex-1 gap-1 border-b border-gray-300 text-sm dark:border-gray-600' onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'targets' : reviewTab === 'overview' ? 'targets' : 'overview';
                setReviewTab(next);
                event.currentTarget.querySelector<HTMLButtonElement>(next === 'overview' ? '#google-sync-overview-tab' : '#google-sync-conflict-targets')?.focus();
              }}>
                <button id='google-sync-overview-tab' type='button' role='tab' tabIndex={reviewTab === 'overview' ? 0 : -1} aria-selected={reviewTab === 'overview'} aria-controls='google-sync-overview' onClick={() => setReviewTab('overview')} className={`whitespace-nowrap rounded-t px-3 py-1 font-medium border-b-2 transition-colors ${reviewTab === 'overview' ? 'border-blue-600 bg-gray-100 text-blue-600 dark:border-blue-400 dark:bg-gray-800/40 dark:text-blue-400' : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/30 dark:hover:text-gray-300'}`}>{t('overview.title')}</button>
                <button id='google-sync-conflict-targets' type='button' role='tab' tabIndex={reviewTab === 'targets' ? 0 : -1} aria-selected={reviewTab === 'targets'} aria-controls='google-sync-targets-panel' onClick={() => setReviewTab('targets')} className={`whitespace-nowrap rounded-t px-3 py-1 font-medium border-b-2 transition-colors ${reviewTab === 'targets' ? 'border-blue-600 bg-gray-100 text-blue-600 dark:border-blue-400 dark:bg-gray-800/40 dark:text-blue-400' : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/30 dark:hover:text-gray-300'}`}>{t(conflictKeys.length ? 'conflict.targets' : 'conflict.targetsUnknown', { count: conflictKeys.length })}</button>
              </div>
              <InfoTooltip text={<><p>{t('overview.help')}</p><p className='mt-2'>{t('overview.scope')}</p>{cloudOverview && cloudOverview.versions > 1 && <p className='mt-2'>{t('overview.multipleVersions', { count: cloudOverview.versions })}</p>}</>} />
            </div>
            <div className='relative mt-2 h-[104px] min-h-0'>
            {reviewTab === 'overview' ? <div id='google-sync-overview' role='tabpanel' aria-labelledby='google-sync-overview-tab' className='h-full text-xs'>
              <table className='w-full border-collapse text-left leading-5'>
                <caption className='sr-only'>{t('overview.title')}</caption>
                <thead><tr><td className='w-px border border-gray-300 bg-gray-100 px-2 py-0.5 dark:border-gray-600 dark:bg-gray-800/30' /><th scope='col' className='border border-gray-300 bg-gray-100 px-2 py-0.5 text-center font-medium dark:border-gray-600 dark:bg-gray-800/30'>{t('conflict.device')}</th><th scope='col' className='border border-gray-300 bg-gray-100 px-2 py-0.5 text-center font-medium dark:border-gray-600 dark:bg-gray-800/30'>{t('overview.cloud')}</th></tr></thead>
                <tbody>{(['chats', 'messages', 'bytes'] as const).map(field => <tr key={field}>
                  <th scope='row' className='w-px whitespace-nowrap border border-gray-300 bg-gray-100 px-2 py-0.5 font-normal dark:border-gray-600 dark:bg-gray-800/30'>{t(`overview.${field}`)}</th>
                  {[localOverview, cloudOverview].map((overview, index) => <td key={index} className='border border-gray-300 px-2 py-0.5 text-right tabular-nums dark:border-gray-600'>{overview ? field === 'bytes' ? formatFileSize(String(overview.bytes), navigator.language) : new Intl.NumberFormat(navigator.language).format(overview[field]) : '—'}</td>)}
                </tr>)}</tbody>
              </table>
              {(!localOverview || !cloudOverview) && <p role='status' className='mt-1 text-gray-500 dark:text-gray-400'>{t(overviewFailed || localOverviewFailed ? 'overview.failed' : 'overview.loading')}{(overviewFailed || localOverviewFailed) && <button type='button' className='ml-2 underline' onClick={() => setOverviewAttempt(attempt => attempt + 1)}>{t('overview.retry')}</button>}</p>}
            </div> : <div id='google-sync-targets-panel' role='tabpanel' aria-labelledby='google-sync-conflict-targets' className='h-full'>
            <div ref={conflictTargetsRef} onScroll={updateMoreTargets} tabIndex={0} role='region' aria-labelledby='google-sync-conflict-targets' className='hide-scroll-bar h-full overflow-y-auto overscroll-contain' style={{ scrollbarWidth: 'none' }}>
            {conflictKeys.length ? <ul className='space-y-2 text-xs'>
              {conflictKeys.map(key => {
                let path: string[];
                try { path = JSON.parse(key); } catch { return <li key={key} className='break-all'>{key}</li>; }
                if (!Array.isArray(path)) return <li key={key} className='break-all'>{key}</li>;
                const chat = path[0] === 'chats' ? chats?.find(chat => chat.id === path[1]) : undefined;
                const folder = path[0] === 'state' && path[1] === 'folders' ? folders?.[path[2]] : undefined;
                const node = chat?.branchTree?.nodes[path[4]];
                const preview = node ? resolveContentText(contentStore, node.contentHash).slice(0, 120) : '';
                const kind = path[0] === 'chats' ? 'chat' : path[1] === 'folders' ? 'folder' : ['content', 'assets'].includes(path[0]) ? 'content' : 'settings';
                return <li key={key} className='break-words'>
                  <button type='button' disabled={isBusy} onClick={() => setDetail({ key, snapshot: structuredClone(snapshot()) })} className='flex w-full items-center justify-between gap-3 rounded p-1 text-left hover:bg-gray-200/60 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-600/60'>
                  <span className='min-w-0'><span className='font-medium'>{chat?.title ?? folder?.name ?? (kind === 'settings' ? t(`settingsFields.${path[1]}`, { defaultValue: path[1] ?? t('conflict.settings') }) : t(`conflict.${kind}`))}</span>
                  <span className='mt-0.5 block text-gray-500 dark:text-gray-400'>{preview || (kind === 'settings' ? path.slice(2).map((field, index) => <span key={index} className='block pl-2'>{t(`settingsFields.${field}`, { defaultValue: field })}</span>) : t(`conflict.fields.${path[path.length - 1]}`, { defaultValue: t('conflict.otherField') }))}</span>
                  </span><span className='shrink-0 text-blue-600 dark:text-blue-400'>{t('details.open')}</span>
                  </button>
                </li>;
              })}
            </ul> : <p className='text-xs'>{t('conflict.unknownTargets')}</p>}
            </div>
            {hasMoreTargets && <div aria-hidden='true' data-testid='google-sync-targets-more' className='pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-gray-50 to-transparent dark:from-gray-700' />}
            </div>}
            </div>
          </div>
          <fieldset className='mt-4 flex min-w-0 shrink-0 flex-col gap-3 border-t border-gray-300 pt-3 dark:border-gray-600' disabled={isBusy}>
            <legend className='pr-2 text-xs font-medium text-gray-600 dark:text-gray-300'>{t('conflict.resolutionTitle')}</legend>
            {(['merge', 'local', 'cloud'] as const).map(mode => <label key={mode}
              className={`rounded-lg border bg-gray-100/80 p-3 focus-within:ring-2 focus-within:ring-gray-500 dark:bg-gray-800/60 dark:focus-within:ring-gray-300 ${isBusy ? 'cursor-wait' : 'cursor-pointer'} ${selectedResolution === mode ? 'border-gray-500 dark:border-gray-300' : 'border-gray-300 dark:border-gray-600'}`}>
              <span className='flex items-center gap-2 font-medium'>
                <input type='radio' name='google-sync-resolution' value={mode}
                  checked={selectedResolution === mode} onChange={() => setSelectedResolution(mode)}
                  aria-label={t(`conflict.${mode}`) as string}
                  className='shrink-0 accent-gray-600 dark:accent-gray-300' />
                {t(`conflict.${mode}`)}
                <span className='ml-auto shrink-0'><InfoTooltip text={t(mode === 'merge' ? 'conflict.description' : `conflict.${mode}Description`)} /></span>
              </span>
              <span className='mt-2 flex items-center justify-center gap-3 text-xs font-medium'>
                <span>{t('conflict.device')}</span>
                <span className={`flex rounded-full border border-gray-300 bg-white/95 px-2 py-1.5 shadow-sm dark:border-gray-600 dark:bg-gray-800/95 ${mode === 'merge' ? 'text-emerald-700 dark:text-emerald-300' : mode === 'local' ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`} aria-hidden='true'>
                  <DownArrow className={`m-0 h-6 w-6 ${mode === 'cloud' ? 'rotate-90' : '-rotate-90'}`} />
                  {mode === 'merge' && <DownArrow className='m-0 h-6 w-6 rotate-90' />}
                </span>
                <span>Google Drive</span>
              </span>
            </label>)}
          </fieldset>
        </section>}
        {!conflict && <>
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
          <div className='mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300'>
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
        </>}
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
