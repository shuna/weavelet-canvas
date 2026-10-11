import { useState } from 'react';
import useCloudAuthStore from '@store/cloud-auth-store';
import { compactGoogleSyncHistory, isGoogleSyncUnlocked } from '@store/storage/GoogleCloudStorage';
import { showToast } from '@utils/showToast';
import { useTranslation } from 'react-i18next';
import { useGoogleSyncDiagnostics } from '@store/storage/google/diagnostics';
import { useGoogleSyncProgress } from '@store/storage/google/progress';
import { getSyncMetrics } from '@store/storage/google/metrics';
import { InfoTooltip } from '@components/ConfigMenu/fields';

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
      <div className='mt-2 flex items-center justify-between gap-2'>
        <span>{diagnostics.active ? t(`progress.${progress.phase}`) : diagnostics.observed ? t('debug.elapsed', { time: seconds(diagnostics.elapsedMs) }) : t('debug.noMeasurement')}</span>
        <InfoTooltip text={<div className='space-y-2'>
          <p>{t('debug.measurement')}</p>
          <p>{t('debug.referenceHelp')}</p>
        </div>} />
      </div>
      {diagnostics.observed && <div className='mt-2 space-y-3 break-words' aria-live='polite'>
        <section>
          <h3 className='mb-1 font-semibold'>{t('debug.sections.transfer')}</h3>
          <dl className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 tabular-nums'>
            <dt>{t('progress.sent')}</dt><dd className='text-right'>{size(progress.uploadedBytes)} · {speed(progress.uploadedBytes, progress.uploadMs)}</dd>
            <dt>{t('progress.received')}</dt><dd className='text-right'>{size(progress.downloadedBytes)} · {speed(progress.downloadedBytes, progress.downloadMs)}</dd>
          </dl>
          <details className='mt-1'>
            <summary className='cursor-pointer text-gray-500 dark:text-gray-400'>{t('debug.sections.breakdown')}</summary>
            <table className='mt-1 w-full tabular-nums'>
              <thead><tr><th className='text-left font-normal'>{t('debug.purpose')}</th><th className='text-right font-normal'>{t('progress.sent')}</th><th className='text-right font-normal'>{t('progress.received')}</th></tr></thead>
              <tbody>{(['normal', 'compaction', 'verification', 'pack-index', 'pack'] as const).map(purpose => <tr key={purpose}>
                <th scope='row' className='py-0.5 text-left font-normal'>{t(`debug.transferPurpose.${purpose}`)}</th>
                <td className='pl-2 text-right whitespace-nowrap'>{size(transfers[purpose].uploaded)}</td>
                <td className='pl-2 text-right whitespace-nowrap'>{size(transfers[purpose].downloaded)}</td>
              </tr>)}</tbody>
            </table>
            <p className='mt-1'>{t('debug.packAccess', { skipped: diagnostics.packSkipped, read: diagnostics.packRead })}</p>
          </details>
        </section>
        <section>
          <h3 className='mb-1 font-semibold'>{t('debug.sections.processing')}</h3>
          <dl className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 tabular-nums'>
            <dt>{t('debug.compression')}</dt><dd>{seconds(metrics.compress?.ms ?? 0)}</dd>
            <dt>{t('debug.crypto')}</dt><dd>{seconds((metrics.encrypt?.ms ?? 0) + (metrics.decrypt?.ms ?? 0))}</dd>
            <dt>{t('debug.cache')}</dt><dd>{seconds(metrics.cache?.ms ?? 0)}</dd>
          </dl>
        </section>
        <section>
          <h3 className='mb-1 font-semibold'>{t('debug.sections.compaction')}</h3>
          <div>{t(`debug.compactionStatus.${compaction.status}`)} · {t('debug.completedGroups', { groups: diagnostics.compactionsCompleted })}</div>
          {compaction.reason && <p className='mt-1 text-gray-500 dark:text-gray-400'>{t(`debug.compactionReason.${compaction.reason}`)}</p>}
          {last && <p className='mt-1'>{t('debug.lastCompaction', { time: new Date(last.at).toLocaleTimeString(),
            before: last.sourceFiles, after: last.newFiles, reduction: Math.max(0, (last.sourceFiles ?? 0) - (last.newFiles ?? 0)) })}</p>}
        </section>
      </div>}
      {history && <details className='mt-3 break-words'>
        <summary className='cursor-pointer font-semibold'>{t('debug.sections.history')}</summary>
        <p className='my-1 text-gray-500 dark:text-gray-400'>{t('debug.observation', { time: new Date(history.observedAt).toLocaleTimeString() })}</p>
        <dl className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 tabular-nums'>
          <dt>{t('debug.unaggregated')}</dt><dd>{t('debug.thresholdCount', { count: history.unaggregated, threshold: history.threshold })}</dd>
          <dt>{t('debug.overThreshold')}</dt><dd>{history.overThreshold}</dd>
          <dt>{t('debug.indexes')}</dt><dd>{history.packCount}</dd>
          <dt>{t('debug.bodies')}</dt><dd>{history.payloadFiles}</dd>
          <dt>{t('debug.smallPacks')}</dt><dd>{history.smallPacks}</dd>
          <dt>{t('debug.referenceFiles')}</dt><dd>{history.referenceFiles}</dd>
          <dt>{t('debug.excessFiles')}</dt><dd>{history.excessPayloadFiles}</dd>
          <dt>{t('debug.cleanupTargets')}</dt><dd>{history.cleanupTargets}</dd>
        </dl>
      </details>}
      <button className='btn btn-small btn-neutral mt-2' disabled={compacting || progress.active || !isGoogleSyncUnlocked(folderId ?? undefined)}
        onClick={async () => {
          setCompacting(true);
          try { await compactGoogleSyncHistory(); showToast(t('debug.compactCompleted'), 'success'); }
          catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error'); }
          finally { setCompacting(false); }
        }}>{t(compacting ? 'debug.compacting' : 'debug.compactNow')}</button>
    </details>
  );
}
