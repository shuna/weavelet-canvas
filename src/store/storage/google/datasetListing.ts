export const DEFAULT_SYNC_FOLDER_NAME = 'Weavelet encrypted sync';
export const defaultSyncFolderName = (id: string) => `${DEFAULT_SYNC_FOLDER_NAME} (${id})`;
export function nextSyncFolderName(name: string, names: string[]): string {
  const base = name.trim();
  const used = new Set(names);
  let candidate = base, suffix = 2;
  while (used.has(candidate)) candidate = `${base} (${suffix++})`;
  return candidate;
}

export const DRIVE_LIST_FIELDS = 'id,kind,name,mimeType,modifiedTime,size';
export const DRIVE_LIST_QUERY = "trashed = false and (mimeType = 'application/json' or appProperties has { key='weaveletSync' and value='1' } or (mimeType = 'application/octet-stream' and name contains '.json'))";
export function driveListParameters(q = DRIVE_LIST_QUERY, fields = DRIVE_LIST_FIELDS): Record<string, string> {
  return { q, orderBy: 'modifiedTime desc', pageSize: '1000', fields: `nextPageToken,incompleteSearch,files(${fields})` };
}
