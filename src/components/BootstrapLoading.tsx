import { useEffect, useState } from 'react';
import type { ChatDataLoadProgress } from '@store/storage/IndexedDbStorage';
import { useTranslation } from 'react-i18next';

export default function BootstrapLoading({ phase, progress }: { phase: string; progress?: ChatDataLoadProgress }) {
  const { t } = useTranslation('main', { useSuspense: false });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className='flex h-full w-full items-center justify-center bg-white px-6 text-gray-800 dark:bg-gray-900 dark:text-gray-100' data-testid='bootstrap-loading' aria-busy='true'>
      <div className='w-full max-w-sm space-y-4 text-center'>
        <div aria-hidden='true' className='mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-600 motion-reduce:animate-none dark:border-gray-600 dark:border-t-emerald-400' />
        <h1 className='text-lg font-medium'>{t('bootstrap.title', { defaultValue: 'Opening your workspace' })}</h1>
        <p role='status' className='text-sm'>{t(`bootstrap.${progress?.stage ?? phase}`, { defaultValue: 'Loading saved conversations…' })}</p>
        {progress?.total !== undefined && <div className='space-y-2' data-testid='bootstrap-progress'>
          <p className='text-sm' role='status'>{t('bootstrap.chatProgress', { completed: progress.completed ?? 0, total: progress.total })}</p>
          <progress className='w-full' aria-label={String(t('bootstrap.chatProgress', { completed: progress.completed ?? 0, total: progress.total }))} value={progress.completed ?? 0} max={Math.max(1, progress.total)} />
        </div>}
        <p className='text-sm text-gray-500 dark:text-gray-400'>{t('bootstrap.description', { defaultValue: 'Preparing saved data. Large conversation histories may take longer to load.' })}</p>
        {elapsed >= 10 && <p className='text-xs text-gray-500 dark:text-gray-400' data-testid='bootstrap-waiting'>
          {t('bootstrap.waiting', { seconds: elapsed, defaultValue: 'Still waiting for data to finish loading ({{seconds}} seconds). Please keep this window open.' })}
        </p>}
      </div>
    </div>
  );
}
