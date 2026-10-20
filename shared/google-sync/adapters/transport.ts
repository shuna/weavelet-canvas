export const SYNC_FOLDER_TYPE = 'application/vnd.google-apps.folder';
export class SyncFileNotFoundError extends Error { override name = 'NotFoundError'; }
export class InvalidSyncFileIdError extends Error {}
export { SyncFileNotFoundError as DriveNotFoundError };
