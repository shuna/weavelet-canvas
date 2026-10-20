// The old native writer uses a separate record; never use it as the current sync target.
export const LEGACY_IOS_CLOUDKIT_SOURCE = {
  recordName: 'weavelet-ios-snapshot',
  recordType: 'WeaveletSnapshot',
  snapshotVersion: 1,
} as const;

// GoogleDriveSyncProvider's fixed appData name; migration never writes this file.
export const LEGACY_IOS_GOOGLE_SOURCE = {
  filename: 'weavelet-canvas-sync.wvlt',
  scope: 'https://www.googleapis.com/auth/drive.appdata',
  parameters: {
    q: "name='weavelet-canvas-sync.wvlt' and trashed=false",
    spaces: 'appDataFolder',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
    fields: 'nextPageToken,incompleteSearch,files(id,name)',
  },
} as const;

export function legacyIOSGoogleFile(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid legacy Google listing.');
  const listing = result as { incompleteSearch?: unknown; files?: unknown };
  if ((listing.incompleteSearch !== undefined && listing.incompleteSearch !== false) || !Array.isArray(listing.files)) throw new Error('Incomplete legacy Google listing.');
  if (!listing.files.length) return null;
  const file = listing.files[0];
  if (!file || typeof file.id !== 'string' || !file.id || file.name !== LEGACY_IOS_GOOGLE_SOURCE.filename) throw new Error('Invalid legacy Google file.');
  return file.id;
}
