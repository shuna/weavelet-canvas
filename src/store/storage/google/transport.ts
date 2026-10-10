import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from '../sync/transport';
import type { TransferPurpose } from './diagnostics';
import { measure, recordMetric } from './metrics';
import { beginTransfer } from './progress';
import { googleFetch } from '@api/google-auth';
import { createMultipartRelatedBody } from '@api/helper';
import type { GoogleFileResource } from '@type/google-api';
import { digest } from './crypto';

export const DEFAULT_SYNC_FOLDER_NAME = 'Weavelet encrypted sync';
export function nextSyncFolderName(name: string, names: string[]): string {
  const base = name.trim();
  const used = new Set(names);
  let candidate = base, suffix = 2;
  while (used.has(candidate)) candidate = `${base} (${suffix++})`;
  return candidate;
}

export const SYNC_FOLDER_TYPE = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
export interface DriveFile extends GoogleFileResource {
  appProperties?: Record<string, string>;
}
export { SyncFileNotFoundError as DriveNotFoundError };
export class DriveTransport implements SyncTransport<DriveFile> {
  constructor(private token: () => string) {}

  private async request(url: string, init: RequestInit = {}) {
    return googleFetch(url, this.token(), init);
  }
  private async json(url: string, init?: RequestInit): Promise<any> {
    const started = performance.now();
    const response = await this.request(url, init);
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
    const text = await response.text();
    recordMetric('drive', started, typeof init?.body === 'string' ? new TextEncoder().encode(init.body).length : 0, new TextEncoder().encode(text).length);
    return JSON.parse(text);
  }

  async ids(count: number): Promise<string[]> {
    if (!Number.isInteger(count) || count < 1) throw new Error('Invalid Drive ID count.');
    const ids: string[] = [];
    while (ids.length < count) {
      const batch = Math.min(1000, count - ids.length);
      const started = performance.now();
      const data = await this.json(`${API}/files/generateIds?count=${batch}&space=drive&type=files`);
      recordMetric('ids', started, 0, new TextEncoder().encode(JSON.stringify(data)).length);
      if (!Array.isArray(data.ids) || data.ids.length !== batch || data.ids.some((id: unknown) => typeof id !== 'string' || !id)) {
        throw new Error('Drive did not return the requested file IDs.');
      }
      ids.push(...data.ids);
    }
    if (new Set(ids).size !== count) throw new Error('Drive returned duplicate file IDs.');
    return ids;
  }
  async id(): Promise<string> { return (await this.ids(1))[0]; }
  async metadata(id: string): Promise<DriveFile> {
    return this.json(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,appProperties,trashed`).then((file) => {
      if (file.trashed) throw new Error('Sync folder was deleted.');
      return file;
    });
  }
  async keyHeader(dataset: string): Promise<string> {
    const file = await this.metadata(dataset);
    if (file.mimeType !== SYNC_FOLDER_TYPE || file.appProperties?.weaveletSync !== '1' || !file.appProperties.headerId) {
      throw new Error('Legacy sync files are read-only. Create a new encrypted sync folder.');
    }
    return file.appProperties.headerId;
  }
  async folder(id: string, headerId: string, name = `${DEFAULT_SYNC_FOLDER_NAME} (${id})`): Promise<DriveFile> {
    if (!name.trim()) throw new Error('Enter a sync folder name.');
    return this.json(`${API}/files?fields=id,name,mimeType,appProperties`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: name.trim(), mimeType: SYNC_FOLDER_TYPE,
        appProperties: { weaveletSync: '1', headerId } }),
    });
  }
  async read(id: string, purpose: TransferPurpose = 'normal'): Promise<Uint8Array> {
    const finish = beginTransfer('download', purpose);
    const started = performance.now();
    const response = await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    if (response.status === 404) throw new SyncFileNotFoundError('Google Drive 404: missing sync file.');
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    finish(bytes.length);
    recordMetric('drive', started, 0, bytes.length);
    return bytes;
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array): Promise<void> {
    const boundary = `weavelet-${crypto.randomUUID()}`;
    const file = new File([bytes], `${id}.bin`, { type: 'application/octet-stream' });
    const body = createMultipartRelatedBody({ id, name: file.name, mimeType: file.type,
      parents: [dataset], appProperties: { dataset, kind } }, file, boundary);
    const finish = beginTransfer('upload', kind === 'pack' || kind === 'pack-part' ? 'compaction' : 'normal');
    const response = await measure('drive', () => this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    }), body.size);
    // A pre-generated ID makes retry after a lost response idempotent. Verify it is our exact ciphertext.
    if (response.status === 409) {
      if (await digest(await this.read(id)) !== await digest(bytes)) throw new Error('Drive file ID collision.');
      return;
    }
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
    finish(bytes.length);
  }
  async startToken(): Promise<string> {
    return (await this.json(`${API}/changes/startPageToken`)).startPageToken;
  }
  async commits(dataset: string): Promise<string[]> {
    return this.listKind(dataset, 'commit');
  }
  async packs(dataset: string): Promise<string[]> {
    return this.listKind(dataset, 'pack');
  }
  async remove(id: string): Promise<void> {
    const response = await this.request(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    // Deleting the captured source set is safe to retry after a lost response.
    if (!response.ok && response.status !== 404) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
  }
  private async listKind(dataset: string, kind: 'commit' | 'pack'): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${dataset.replace(/['\\]/g, '\\$&')}' in parents and trashed = false and appProperties has { key='kind' and value='${kind}' }`,
        fields: 'nextPageToken,incompleteSearch,files(id)', pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.json(`${API}/files?${params}`);
      if (page.incompleteSearch) throw new Error('Incomplete Drive listing; sync stopped.');
      ids.push(...page.files.map((file: { id: string }) => file.id));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return ids;
  }
  async changes(token: string): Promise<{ token: string; changes: SyncChange[] }> {
    const changes: SyncChange[] = [];
    let pageToken = token;
    for (;;) {
      const params = new URLSearchParams({ pageToken, pageSize: '1000',
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,trashed,appProperties))' });
      const page = await this.json(`${API}/changes?${params}`);
      changes.push(...page.changes.map((change: { fileId: string; removed?: boolean; file?: DriveFile & { trashed?: boolean } }): SyncChange => ({
        id: change.fileId,
        removed: change.removed || change.file?.trashed,
        dataset: change.file?.appProperties?.dataset,
        kind: change.file?.appProperties?.kind,
      })));
      if (!page.nextPageToken) return { token: page.newStartPageToken, changes };
      pageToken = page.nextPageToken;
    }
  }
}
