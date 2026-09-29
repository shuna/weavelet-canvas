import { beginTransfer } from './progress';
import { googleFetch } from '@api/google-auth';
import { createMultipartRelatedBody } from '@api/helper';
import type { GoogleFileResource } from '@type/google-api';
import { digest } from './crypto';

export const SYNC_FOLDER_TYPE = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
export interface DriveFile extends GoogleFileResource {
  appProperties?: Record<string, string>;
}
export class DriveTransport {
  constructor(private token: () => string) {}

  private async request(url: string, init: RequestInit = {}) {
    return googleFetch(url, this.token(), init);
  }
  private async json(url: string, init?: RequestInit): Promise<any> {
    const response = await this.request(url, init);
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
    return response.json();
  }
  async id(): Promise<string> {
    const data = await this.json(`${API}/files/generateIds?count=1&space=drive&type=files`);
    if (typeof data.ids?.[0] !== 'string') throw new Error('Drive did not return a file ID.');
    return data.ids[0];
  }
  async metadata(id: string): Promise<DriveFile> {
    return this.json(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,appProperties,trashed`).then((file) => {
      if (file.trashed) throw new Error('Sync folder was deleted.');
      return file;
    });
  }
  async folder(id: string, headerId: string): Promise<DriveFile> {
    return this.json(`${API}/files?fields=id,name,mimeType,appProperties`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: 'Weavelet encrypted sync', mimeType: SYNC_FOLDER_TYPE,
        appProperties: { weaveletSync: '1', headerId } }),
    });
  }
  async read(id: string): Promise<Uint8Array> {
    const finish = beginTransfer('download');
    const response = await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    if (!response.ok) throw new Error(`Google Drive ${response.status}: ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    finish(bytes.length);
    return bytes;
  }
  async put(id: string, dataset: string, kind: string, bytes: Uint8Array): Promise<void> {
    const boundary = `weavelet-${crypto.randomUUID()}`;
    const file = new File([bytes], `${id}.bin`, { type: 'application/octet-stream' });
    const body = createMultipartRelatedBody({ id, name: file.name, mimeType: file.type,
      parents: [dataset], appProperties: { dataset, kind } }, file, boundary);
    const finish = beginTransfer('upload');
    const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
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
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${dataset.replace(/['\\]/g, '\\$&')}' in parents and trashed = false and appProperties has { key='kind' and value='commit' }`,
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
  async changes(token: string): Promise<{ token: string; changes: { fileId: string; removed?: boolean; file?: DriveFile & { trashed?: boolean } }[] }> {
    const changes = [];
    let pageToken = token;
    for (;;) {
      const params = new URLSearchParams({ pageToken, pageSize: '1000',
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,trashed,appProperties))' });
      const page = await this.json(`${API}/changes?${params}`);
      changes.push(...page.changes);
      if (!page.nextPageToken) return { token: page.newStartPageToken, changes };
      pageToken = page.nextPageToken;
    }
  }
}
