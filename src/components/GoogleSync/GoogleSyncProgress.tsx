import { useTranslation } from 'react-i18next';
import { useSyncProgressDisplay } from '@hooks/useSyncProgressDisplay';

const size = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${(bytes / 1024).toFixed(1)} KB`;

export default function GoogleSyncProgress() {
  const { t } = useTranslation('drive');
  const progress = useSyncProgressDisplay();
  if (!progress.active) return null;
  const percent = progress.totalFiles && progress.totalFiles > 0
    ? Math.min(100, Math.floor(progress.completedFiles / progress.totalFiles * 100)) : undefined;
  return (
    <div className='mt-2 space-y-1 text-xs' data-testid='google-sync-progress'>
      <div>{t(`progress.${progress.phase}`)}{percent !== undefined && ` — ${percent}%`}</div>
      <progress className='h-2 w-full accent-emerald-500' max={100} value={percent ?? 0}
        aria-label={t(`progress.${progress.phase}`) as string} />
      {progress.totalFiles !== undefined && (
        <div>{t('progress.files', { done: progress.completedFiles, total: progress.totalFiles })}
          {progress.totalBytes !== undefined && <>{' · '}{size(progress.completedBytes)} / {size(progress.totalBytes)}</>}</div>
      )}
      {progress.downloadedFiles > 0 && <div>{t('progress.downloadedFiles', { count: progress.downloadedFiles })}</div>}
      <div>{t('progress.sent')}: {size(progress.uploadedBytes)}
        {' · '}{progress.uploadMs > 0 ? `${size(progress.uploadedBytes * 1000 / progress.uploadMs)}/s` : t('progress.measuring')}</div>
      <div>{t('progress.received')}: {size(progress.downloadedBytes)}
        {' · '}{progress.downloadMs > 0 ? `${size(progress.downloadedBytes * 1000 / progress.downloadMs)}/s` : t('progress.measuring')}</div>
      <div className='text-gray-500 dark:text-gray-400'>{t('progress.measurement')}</div>
    </div>
  );
}
