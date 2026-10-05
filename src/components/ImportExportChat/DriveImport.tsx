import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useCloudAuthStore from '@store/cloud-auth-store';
import { listDriveFiles } from '@api/google-api';
import { importGoogleSyncSnapshot } from '@store/storage/GoogleCloudStorage';
import { SYNC_FOLDER_TYPE, type DriveFile } from '@store/storage/google/transport';
import { withSyncProgress, useGoogleSyncProgress } from '@store/storage/google/progress';
import GoogleSyncProgress from '@components/GoogleSync/GoogleSyncProgress';
import { readDriveImportSnapshot } from './driveImportService';

export default function DriveImport({ file }: { file?: File }) {
  const { t } = useTranslation('import');
  const token = useCloudAuthStore(state => state.googleAccessToken);
  const active = useGoogleSyncProgress(state => state.active);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [folderId, setFolderId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <details className='mt-3 text-xs text-gray-600 dark:text-gray-300'>
    <summary className='cursor-pointer'>{t('drive.title')}</summary>
    <p className='my-2'>{t('drive.description')}</p>
    {!token ? <p>{t('drive.connect')}</p> : <div className='space-y-2'>
      <button className='btn btn-small btn-neutral' disabled={busy || active} onClick={() => void run(async () => {
        const result = await listDriveFiles(token);
        setFolders(result.files.filter(file => file.mimeType === SYNC_FOLDER_TYPE));
      })}>{t('drive.loadFolders')}</button>
      <label className='block'>{t('drive.folder')}
        <select className='w-full bg-transparent border rounded p-1' value={folderId} disabled={busy || active}
          onChange={event => setFolderId(event.target.value)}>
          <option value=''>{t('drive.selectFolder')}</option>
          {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
      <label className='block'>{t('drive.passphrase')}
        <input type='password' autoComplete='off' className='w-full bg-transparent border rounded p-1'
          value={password} onChange={event => setPassword(event.target.value)} disabled={busy || active} />
      </label>
      <button className='btn btn-small btn-primary' disabled={!file || !folderId || busy || active}
        onClick={() => void run(() => withSyncProgress(async () => {
          const snapshot = await readDriveImportSnapshot(file!);
          await importGoogleSyncSnapshot(folderId, password, snapshot);
          setPassword(''); setMessage(String(t('drive.completed')));
        }))}>{t('drive.upload')}</button>
      <GoogleSyncProgress />
    </div>}
    {message && <p className='mt-2 whitespace-pre-wrap' role='status'>{message}</p>}
  </details>;
}
