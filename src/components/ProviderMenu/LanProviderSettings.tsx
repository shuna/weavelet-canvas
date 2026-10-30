import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import type { ProviderConfig } from '@type/provider';

export default function LanProviderSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useTranslation('model');
  const saved = useStore(s => s.providers.lan);
  const save = useStore(s => s.saveLanProvider);
  const [form, setForm] = useState<ProviderConfig>(saved);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!dirty) setForm(saved); }, [saved, dirty]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const update = (patch: Partial<ProviderConfig>) => { setForm(previous => ({ ...previous, ...patch })); setDirty(true); setError(''); };
  const inputClass = 'w-full rounded border p-2 text-sm dark:bg-gray-800 dark:border-gray-600 text-gray-900 dark:text-gray-100';
  return <form className='p-3 border-t dark:border-gray-600 space-y-2 text-gray-800 dark:text-gray-200 overflow-y-auto max-h-[60vh] shrink-0' onSubmit={event => {
    event.preventDefault();
    try { save(form); setDirty(false); setError(''); } catch { setError(t('lan.invalidSettings') as string); }
  }}>
    <label className='block text-sm'>{t('lan.endpoint')}<input className={inputClass} value={form.endpoint} onChange={event => update({ endpoint: event.target.value })} /></label>
    <label className='block text-sm'>{t('lan.modelsEndpoint')}<input className={inputClass} value={form.modelsEndpoint ?? ''} onChange={event => update({ modelsEndpoint: event.target.value })} /></label>
    <label className='block text-sm'>{t('lan.authentication')}<select className={inputClass} value={String(form.modelsRequireAuth)} onChange={event => update({ modelsRequireAuth: event.target.value === 'true' })}>
      <option value='false'>{t('lan.noAuth')}</option><option value='true'>Bearer API key</option>
    </select></label>
    {form.modelsRequireAuth && <label className='block text-sm'>API key<input type='password' autoComplete='off' className={inputClass} value={form.apiKey ?? ''} onChange={event => update({ apiKey: event.target.value })} /></label>}
    {form.endpoint.trim().startsWith('http:') && <p className='text-sm'>{t('lan.httpWarning')}</p>}
    <p className='text-xs'>{t('lan.connectionHelp')}</p>
    {error && <p role='alert' className='text-sm text-red-500'>{error}</p>}
    <button type='submit' disabled={!dirty} className='px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50'>{t('custom.save', 'Save')}</button>
  </form>;
}
