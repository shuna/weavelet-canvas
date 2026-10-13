import { applyExternalSnapshot } from '../../applyExternalSnapshot';
import type { StorageValue } from 'zustand/middleware';
import {
  cloudKitBytesToCompressed,
  cloudKitCompressedToBytes,
  cloudKitLocalWins,
  cloudKitPayloadJSON,
  cloudKitSnapshotLayout,
} from '../../../../../shared/google-sync/cloudKit';

import {
  CLOUDKIT_DEFAULT_RECORD_NAME,
  CloudKitConflictError,
  type CloudKitRecord,
  deleteCloudKitRecord,
  fetchCloudKitRecord,
  getCloudKitConfig,
  isCloudKitAuthError,
  saveCloudKitRecord,
} from '@api/cloudkit';
import { getOrCreateDeviceId } from '@utils/deviceId';
import useCloudAuthStore from '@store/cloud-auth-store';
import useStore from '@store/store';
import {
  needsDataMigration,
  type PersistedStoreState,
} from '@store/persistence';
import { STORE_VERSION } from '@store/version';
import i18next from 'i18next';
import { showToast } from '@utils/showToast';
import type { CloudSyncProvider, CloudSyncTarget } from '../types';

// --- Base64 helpers ---
// lz-string compress() outputs arbitrary UTF-16 code units (including surrogates
// and code points above U+00FF). TextEncoder (UTF-8) cannot round-trip these.
// We encode the little-endian raw bytes via btoa, preserving every code unit.

export const lzStringToBase64 = (str: string): string => {
  const bytes = cloudKitCompressedToBytes(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const base64ToLzString = (b64: string): string =>
  cloudKitBytesToCompressed(base64ToBytes(b64));

// --- Helpers ---

const getCloudSyncTarget = (): CloudSyncTarget | null => {
  const state = useCloudAuthStore.getState();
  const cloudkitState = state.providers.cloudkit;
  if (
    !cloudkitState.sessionToken ||
    cloudkitState.syncStatus === 'unauthenticated'
  ) {
    return null;
  }

  if (!cloudkitState.connectionId) state.setProviderSession('cloudkit', { connectionId: crypto.randomUUID() });
  return {
    accessToken: cloudkitState.sessionToken,
    fileId: CLOUDKIT_DEFAULT_RECORD_NAME,
  };
};

const cloudKitSessionGuard = (target: CloudSyncTarget) => {
  const initial = useCloudAuthStore.getState().providers.cloudkit;
  const { connectionId, sessionToken } = initial;
  const valid = sessionToken === target.accessToken;
  return () => {
    const current = useCloudAuthStore.getState().providers.cloudkit;
    return valid && !!current.sessionToken && (connectionId
      ? current.connectionId === connectionId
      : current.sessionToken === sessionToken);
  };
};

const notifyCloudError = (message: string) => {
  showToast(message, 'error');
};

const maybeUpdateToken = (newWebAuthToken?: string) => {
  if (newWebAuthToken) {
    useCloudAuthStore
      .getState()
      .setProviderSession('cloudkit', { sessionToken: newWebAuthToken });
  }
};

const updateRecordChangeTag = (tag?: string) => {
  useCloudAuthStore
    .getState()
    .setProviderSession('cloudkit', { recordChangeTag: tag });
};

const getRecordChangeTag = (): string | undefined =>
  useCloudAuthStore.getState().providers.cloudkit.recordChangeTag;

const normalizeRemoteRecord = (
  record: CloudKitRecord
): { state: Partial<PersistedStoreState>; version: number } => {
  const payload = record.fields?.payload?.value;
  if (!payload) throw new Error('CloudKit record has no payload.');
  const json = cloudKitPayloadJSON(base64ToBytes(payload));
  const parsed = JSON.parse(json);
  const layout = cloudKitSnapshotLayout(parsed, STORE_VERSION);
  return { state: (layout.wrapped ? parsed.state : parsed) as Partial<PersistedStoreState>, version: layout.version };
};

const hydrateFromServerRecord = async (record: CloudKitRecord, observed: ReturnType<typeof useStore.getState>, isCurrent: () => boolean): Promise<boolean> => {
  const normalized = normalizeRemoteRecord(record);
  const remotePersistedState = structuredClone(normalized.state) as Partial<PersistedStoreState>;

  if (!await applyExternalSnapshot(remotePersistedState, isCurrent, observed, normalized.version)) return false;

  if (needsDataMigration()) {
    useStore.getState().setMigrationUiState({
      visible: true,
      status: 'needs-export-import',
    });
  }
  return true;
};

// --- Validate ---

export const validateCloudKitSync = (): boolean => {
  const state = useCloudAuthStore.getState();
  const cloudkitState = state.providers.cloudkit;
  return !!cloudkitState.sessionToken;
};

// --- Provider ---

export const createCloudKitCloudProvider = <S>(): CloudSyncProvider<S> => ({
  getTarget: getCloudSyncTarget,

  readItem: async (_name, target): Promise<StorageValue<S> | null> => {
    const config = getCloudKitConfig();
    if (!config) return null;

    const isCurrent = cloudKitSessionGuard(target);
    const result = await fetchCloudKitRecord(
      config,
      target.accessToken,
      CLOUDKIT_DEFAULT_RECORD_NAME
    );
    if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
    maybeUpdateToken(result.newWebAuthToken);

    if (!result.record) return null;

    updateRecordChangeTag(result.record.recordChangeTag);

    const payload = result.record.fields?.payload?.value;
    if (!payload) return null;

    const json = cloudKitPayloadJSON(base64ToBytes(payload));
    const parsed = JSON.parse(json);
    cloudKitSnapshotLayout(parsed, STORE_VERSION);
    return parsed as StorageValue<S>;
  },

  writeItem: async (_name, file, target) => {
    const config = getCloudKitConfig();
    if (!config) return;

    const observed = useStore.getState();
    const isCurrent = cloudKitSessionGuard(target);
    const compressed = await file.text();
    if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
    const payload = lzStringToBase64(compressed);
    const recordChangeTag = getRecordChangeTag();
    // Compute updatedAt once — this exact value is written to the record
    // AND used for conflict comparison, ensuring true last-write-wins.
    const updatedAt = Date.now();

    try {
      const result = await saveCloudKitRecord(
        config,
        target.accessToken,
        CLOUDKIT_DEFAULT_RECORD_NAME,
        payload,
        STORE_VERSION,
        getOrCreateDeviceId(),
        recordChangeTag,
        updatedAt
      );

      if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
      updateRecordChangeTag(result.record.recordChangeTag);
      maybeUpdateToken(result.newWebAuthToken);
    } catch (e: unknown) {
      if (e instanceof CloudKitConflictError && isCurrent()) {
        // Fetch latest server record
        const fetchResult = await fetchCloudKitRecord(
          config,
          target.accessToken,
          CLOUDKIT_DEFAULT_RECORD_NAME
        );
        if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
        maybeUpdateToken(fetchResult.newWebAuthToken);

        if (!fetchResult.record) {
          // Record was deleted, retry as create
          const retryResult = await saveCloudKitRecord(
            config,
            target.accessToken,
            CLOUDKIT_DEFAULT_RECORD_NAME,
            payload,
            STORE_VERSION,
            getOrCreateDeviceId(),
            undefined,
            updatedAt
          );
          if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
          updateRecordChangeTag(retryResult.record.recordChangeTag);
          maybeUpdateToken(retryResult.newWebAuthToken);
          return;
        }

        if (cloudKitLocalWins(updatedAt, fetchResult.record.fields?.updatedAt?.value)) {
          // Local wins — retry with server's recordChangeTag
          const retryResult = await saveCloudKitRecord(
            config,
            target.accessToken,
            CLOUDKIT_DEFAULT_RECORD_NAME,
            payload,
            STORE_VERSION,
            getOrCreateDeviceId(),
            fetchResult.record.recordChangeTag,
            updatedAt
          );
          if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
          updateRecordChangeTag(retryResult.record.recordChangeTag);
          maybeUpdateToken(retryResult.newWebAuthToken);
        } else {
          // Server wins — hydrate from server and signal the effective state
          // so the generic layer updates its guard-metrics baseline.
          updateRecordChangeTag(fetchResult.record.recordChangeTag);
          const normalized = normalizeRemoteRecord(fetchResult.record);
          if (!await hydrateFromServerRecord(fetchResult.record, observed, isCurrent)) {
            throw new Error('Local data changed while applying the CloudKit server state. Retry sync.');
          }

          showToast(i18next.t('toast.conflict', { ns: 'cloudkit' }), 'warning');

          return {
            effectiveState: { state: normalized.state, version: normalized.version },
          };
        }
      }
      throw e;
    }
  },

  removeItem: async (_name, target): Promise<void> => {
    const config = getCloudKitConfig();
    if (!config) return;

    const isCurrent = cloudKitSessionGuard(target);
    const result = await deleteCloudKitRecord(
      config,
      target.accessToken,
      CLOUDKIT_DEFAULT_RECORD_NAME
    );
    if (!isCurrent()) throw new Error('CloudKit connection changed during sync.');
    maybeUpdateToken(result.newWebAuthToken);
  },

  isAuthError: isCloudKitAuthError,

  setSyncStatus: (status) => {
    useCloudAuthStore.getState().setSyncStatus(status);
  },

  notifyError: notifyCloudError,
});
