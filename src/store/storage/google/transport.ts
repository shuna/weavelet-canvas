import { SyncFileNotFoundError, type SyncChange, type SyncTransport } from '../sync/transport';
import type { TransferPurpose } from './diagnostics';
import { measure, recordMetric } from './metrics';
import { beginTransfer } from './progress';
import { googleFetch } from '@api/google-auth';
import useCloudAuthStore from '@store/cloud-auth-store';
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
    const connection = useCloudAuthStore.getState().providers.google.connectionId;
    const token = this.token();
    let waited = 0;
    for (let attempt = 0;; attempt++) {
      const response = await googleFetch(url, token, init);
      if (!await this.retryable(response) || attempt === 3 || init.signal?.aborted) return response;
      const delay = this.retryDelay(response, attempt);
      if (waited + delay > 30_000) return response;
      await new Promise<void>(resolve => setTimeout(resolve, delay));
      waited += delay;
      if (init.signal?.aborted || useCloudAuthStore.getState().providers.google.connectionId !== connection ||
          (!connection && this.token() !== token)) return response;
    }
  }
  private async retryable(response: Response): Promise<boolean> {
    if ([429, 500, 502, 503, 504].includes(response.status)) return true;
    if (response.status !== 403) return false;
    try {
      const error = await response.clone().json();
      return error?.error?.errors?.some((value: unknown) => (value as { reason?: unknown })?.reason === 'rateLimitExceeded' ||
        (value as { reason?: unknown })?.reason === 'userRateLimitExceeded') === true;
    } catch { return false; }
  }
  private retryDelay(response: Response, attempt: number): number {
    const value = response.headers.get('Retry-After');
    const retryAfter = value ? (/^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) : NaN;
    return Math.max(1_000 * 2 ** attempt + Math.random() * 1_000, Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0);
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
      const data = await this.json(`${API}/files/generateIds?count=${batch}&space=drive&type=files&fields=ids`);
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
    const body = JSON.stringify({ id, name: name.trim(), mimeType: SYNC_FOLDER_TYPE,
      appProperties: { weaveletSync: '1', headerId } });
    const started = performance.now();
    const response = await this.request(`${API}/files?fields=id,name,mimeType,appProperties`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (response.status === 409) {
      const file = await this.metadata(id);
      if (file.id === id && file.mimeType === SYNC_FOLDER_TYPE && file.appProperties?.weaveletSync === '1' && file.appProperties.headerId === headerId) return file;
    }
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
    const text = await response.text();
    recordMetric('drive', started, new TextEncoder().encode(body).length, new TextEncoder().encode(text).length);
    return JSON.parse(text);
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
    const response = await measure('drive', () => this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
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
    const token = (await this.json(`${API}/changes/startPageToken?fields=startPageToken`)).startPageToken;
    if (typeof token !== 'string' || !token) throw new Error('Invalid Drive start token.');
    return token;
  }
  async history(dataset: string): Promise<{ commits: string[]; packs: string[] }> {
    const commits: string[] = [], packs: string[] = [];
    let pageToken: string | undefined;
    const ids = new Set<string>();
    const tokens = new Set<string>();
    for (;;) {
      const params = new URLSearchParams({
        q: `'${dataset.replace(/['\\]/g, '\\$&')}' in parents and trashed = false and (appProperties has { key='kind' and value='commit' } or appProperties has { key='kind' and value='pack' })`,
        fields: 'nextPageToken,incompleteSearch,files(id,appProperties(kind))', pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.json(`${API}/files?${params}`);
      if (page.incompleteSearch || !Array.isArray(page.files)) throw new Error('Incomplete Drive listing; sync stopped.');
      for (const file of page.files) {
        if (typeof file?.id !== 'string' || !file.id || ids.has(file.id) ||
            (file.appProperties?.kind !== 'commit' && file.appProperties?.kind !== 'pack')) throw new Error('Invalid Drive history listing.');
        ids.add(file.id);
        (file.appProperties.kind === 'commit' ? commits : packs).push(file.id);
      }
      if (page.nextPageToken === undefined) return { commits, packs };
      if (typeof page.nextPageToken !== 'string' || !page.nextPageToken || tokens.has(page.nextPageToken)) throw new Error('Invalid Drive listing token.');
      tokens.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    }
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
    const tokens = new Set<string>();
    do {
      const params = new URLSearchParams({
        q: `'${dataset.replace(/['\\]/g, '\\$&')}' in parents and trashed = false and appProperties has { key='kind' and value='${kind}' }`,
        fields: 'nextPageToken,incompleteSearch,files(id)', pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.json(`${API}/files?${params}`);
      if (page.incompleteSearch || !Array.isArray(page.files) || page.files.some((file: unknown) => typeof (file as { id?: unknown })?.id !== 'string' || !(file as { id: string }).id)) throw new Error('Incomplete Drive listing; sync stopped.');
      ids.push(...page.files.map((file: { id: string }) => file.id));
      if (page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || !page.nextPageToken || tokens.has(page.nextPageToken))) throw new Error('Invalid Drive listing token.');
      if (page.nextPageToken) tokens.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return ids;
  }
  async changes(token: string): Promise<{ token: string; changes: SyncChange[] }> {
    const changes: SyncChange[] = [];
    if (!token) throw new Error('Invalid Drive change token.');
    let pageToken = token;
    const seen = new Set<string>([token]);
    for (;;) {
      const params = new URLSearchParams({ pageToken, pageSize: '1000',
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,trashed,appProperties))' });
      const page = await this.json(`${API}/changes?${params}`);
      if (!Array.isArray(page.changes) || page.changes.some((change: unknown) => typeof (change as { fileId?: unknown })?.fileId !== 'string' || !(change as { fileId: string }).fileId)) throw new Error('Invalid Drive changes.');
      changes.push(...page.changes.map((change: { fileId: string; removed?: boolean; file?: DriveFile & { trashed?: boolean } }): SyncChange => ({
        id: change.fileId,
        removed: change.removed || change.file?.trashed,
        dataset: change.file?.appProperties?.dataset,
        kind: change.file?.appProperties?.kind,
      })));
      if (page.nextPageToken === undefined) {
        if (typeof page.newStartPageToken !== 'string' || !page.newStartPageToken) throw new Error('Invalid Drive change token.');
        return { token: page.newStartPageToken, changes };
      }
      if (typeof page.nextPageToken !== 'string' || !page.nextPageToken || seen.has(page.nextPageToken)) throw new Error('Invalid Drive change token.');
      seen.add(page.nextPageToken);
      pageToken = page.nextPageToken;
    }
  }
}
