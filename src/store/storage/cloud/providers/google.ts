import useCloudAuthStore from '@store/cloud-auth-store';
import useStore from '@store/store';
import {
  deleteDriveFile,
  getDriveFile,
  isGoogleAuthError,
  updateDriveFile,
} from '@api/google-api';
import { showToast } from '@utils/showToast';
import type { CloudSyncProvider, CloudSyncTarget } from '../types';

const getCloudSyncTarget = (): CloudSyncTarget | null => {
  const { googleAccessToken, fileId, syncStatus } = useCloudAuthStore.getState();
  if (!googleAccessToken || !fileId || syncStatus === 'unauthenticated') {
    return null;
  }

  return {
    accessToken: googleAccessToken,
    fileId,
  };
};

const notifyCloudError = (message: string) => {
  showToast(message, 'error');
};

export const validateGoogleCloudSync = () => {
  const { googleAccessToken, fileId } = useCloudAuthStore.getState();
  if (!googleAccessToken || !fileId) return false;

  return true;
};

export const createGoogleCloudProvider = <S>(): CloudSyncProvider<S> => ({
  getTarget: getCloudSyncTarget,
  readItem: async (name, target) => getDriveFile(target.fileId, target.accessToken),
  writeItem: async (name, file, target) => {
    throw new Error('Legacy Google sync uploads are disabled. Use encrypted Google sync.');
  },
  removeItem: async (name, target) => {
    await deleteDriveFile(target.fileId, target.accessToken);
  },
  isAuthError: isGoogleAuthError,
  setSyncStatus: (status) => {
    useCloudAuthStore.getState().setSyncStatus(status);
  },
  notifyError: notifyCloudError,
});
