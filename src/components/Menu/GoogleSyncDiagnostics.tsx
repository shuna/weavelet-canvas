import { useState } from 'react';
import useCloudAuthStore from '@store/cloud-auth-store';
import { compactGoogleSyncHistory, isGoogleSyncUnlocked } from '@store/storage/GoogleCloudStorage';
import { showToast } from '@utils/showToast';
import { useTranslation } from 'react-i18next';
import { useGoogleSyncDiagnostics } from '@store/storage/google/diagnostics';
import { useGoogleSyncProgress } from '@store/storage/google/progress';
import { getSyncMetrics } from '@store/storage/google/metrics';

const size = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const speed = (bytes: number, ms: number) => ms > 0 ? `${size(bytes * 1000 / ms)}/s` : '—';

export default function GoogleSyncDiagnostics() {
  const { t } = useTranslation('drive');
  const diagnostics = useGoogleSyncDiagnostics();
  const folderId = useCloudAuthStore(state => state.fileId);
  const [compacting, setCompacting] = useState(false);
  const progress = useGoogleSyncProgress();
  const metrics = diagnostics.active ? getSyncMetrics() : diagnostics.metrics;
  const history = diagnostics.history;
  const transfers = diagnostics.transfers;
  const compaction = diagnostics.compaction;
  const last = diagnostics.lastCompaction;
  return (
    <details className='my-1 rounded border border-gray-200 dark:border-gray-700 px-1.5 py-1 text-[10px] leading-snug text-gray-700 dark:text-gray-200'
      data-testid='google-sync-diagnostics'>
      <summary className='cursor-pointer font-medium'>
        {t('debug.title')} · {diagnostics.observed ? t(`debug.result.${diagnostics.result}`) : t('debug.noMeasurement')}
      </summary>
      {diagnostics.observed && <div className='mt-1 space-y-0.5 break-words' aria-live='polite'>
        <div>{diagnostics.active ? t(`progress.${progress.phase}`) : t('debug.elapsed', { time: seconds(diagnostics.elapsedMs) })}</div>
        <div>{t('progress.sent')}: {size(progress.uploadedBytes)} · {speed(progress.uploadedBytes, progress.uploadMs)}</div>
        <div>{t('progress.received')}: {size(progress.downloadedBytes)} · {speed(progress.downloadedBytes, progress.downloadMs)}</div>
        <div>{t('debug.normal', { sent: size(transfers.normal.uploaded), received: size(transfers.normal.downloaded) })}</div>
        <div>{t('debug.compactionBytes', { sent: size(transfers.compaction.uploaded), received: size(transfers.verification.downloaded) })}</div>
        <div>{t('debug.packBytes', { index: size(transfers['pack-index'].downloaded), body: size(transfers.pack.downloaded) })}</div>
        <div>{t('debug.packAccess', { skipped: diagnostics.packSkipped, read: diagnostics.packRead })}</div>
        <div>{t('debug.processing', { compression: seconds(metrics.compress?.ms ?? 0),
          crypto: seconds((metrics.encrypt?.ms ?? 0) + (metrics.decrypt?.ms ?? 0)), cache: seconds(metrics.cache?.ms ?? 0) })}</div>
        <div>{t('debug.compaction')}: {t(`debug.compactionStatus.${compaction.status}`)}
          {compaction.reason && ` · ${t(`debug.compactionReason.${compaction.reason}`)}`}
          {' · '}{t('debug.completedGroups', { groups: diagnostics.compactionsCompleted })}</div>
        {last && <div>{t('debug.lastCompaction', { time: new Date(last.at).toLocaleTimeString(),
          before: last.sourceFiles, after: last.newFiles, reduction: Math.max(0, (last.sourceFiles ?? 0) - (last.newFiles ?? 0)) })}</div>}
      </div>}
      {history && <div className='mt-1 space-y-0.5 break-words'>
        <div>{t('debug.observation', { time: new Date(history.observedAt).toLocaleTimeString() })}</div>
        <div>{t('debug.history', { count: history.unaggregated, threshold: history.threshold, excess: history.overThreshold })}</div>
        <div>{t('debug.packs', { indexes: history.packCount, bodies: history.payloadFiles, small: history.smallPacks })}</div>
        <div>{t('debug.reference', { files: history.referenceFiles, excess: history.excessPayloadFiles })}</div>
        <div>{t('debug.cleanup', { count: history.cleanupTargets })}</div>
      </div>}
      <button className='btn btn-small btn-neutral mt-2' disabled={compacting || progress.active || !isGoogleSyncUnlocked(folderId ?? undefined)}
        onClick={async () => {
          setCompacting(true);
          try { await compactGoogleSyncHistory(); showToast(t('debug.compactCompleted'), 'success'); }
          catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
          finally { setCompacting(false); }
        }}>{t(compacting ? 'debug.compacting' : 'debug.compactNow')}</button>
      <p className='mt-1 text-gray-500 dark:text-gray-400'>{t('debug.measurement')}</p>
      <p className='mt-1 text-gray-500 dark:text-gray-400'>{t('debug.referenceHelp')}</p>
    </details>
  );
}
