// Pure metadata boundary shared by Web and native Drive transports.
export const SYNC_FOLDER_TYPE = 'application/vnd.google-apps.folder';
export function encryptedSyncHeaderId(file: { mimeType?: string; appProperties?: Record<string, string> }): string {
  if (file.mimeType !== SYNC_FOLDER_TYPE || file.appProperties?.weaveletSync !== '1' || !file.appProperties.headerId) {
    throw new Error('Legacy sync files are read-only. Create a new encrypted sync folder.');
  }
  return file.appProperties.headerId;
}
