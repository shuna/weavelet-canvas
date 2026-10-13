export const SYNC_FOLDER_TYPE = 'application/vnd.google-apps.folder';
export class SyncFileNotFoundError extends Error { override name = 'NotFoundError'; }
export { SyncFileNotFoundError as DriveNotFoundError };
