import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenRouterChatSettings } from '@type/chat';
import { validateOpenRouterSettings } from '@utils/openrouterControls';

export default function OpenRouterFields({ value, onChange, model, isDefault = false }: {
  value?: OpenRouterChatSettings;
  onChange: (value: OpenRouterChatSettings) => void;
  model: string;
  isDefault?: boolean;
}) {
  const { t } = useTranslation('model');
  const settings = value ?? {};
  const r = settings.routing ?? {};
  const [slugs, setSlugs] = useState({ order: r.order?.join(', ') ?? '', only: r.only?.join(', ') ?? '', ignore: r.ignore?.join(', ') ?? '' });
  const routing = (patch: Partial<NonNullable<OpenRouterChatSettings['routing']>>) => onChange({ ...settings, routing: { ...r, ...patch } });
  const fieldClass = 'w-full rounded border border-gray-400/50 bg-transparent px-2 py-1.5 text-sm';
  const label = (name: string) => t(`openRouter.${name}`) as string;
  const error = validateOpenRouterSettings(value, model);
  const isClaude = model.startsWith('anthropic/claude-');
  const triState = (name: 'allow_fallbacks' | 'require_parameters') => (
    <label className='block'>{label(name)}
      <select className={fieldClass} value={r[name] === undefined ? '' : String(r[name])} onChange={e => routing({ [name]: e.target.value === '' ? undefined : e.target.value === 'true' })}>
        <option value=''>{label('inherit')}</option><option value='true'>{label('yes')}</option><option value='false'>{label('no')}</option>
      </select>
    </label>
  );
  return <fieldset className='rounded-lg border border-gray-300 dark:border-gray-600 p-4 flex flex-col gap-3'>
    <legend className='px-1 font-medium'>OpenRouter</legend>
    <p className='text-xs text-gray-500'>{label(isDefault ? 'defaultScope' : 'scope')}</p>
    <label>{label('selection')}
      <select className={fieldClass} value={r.order?.length ? 'order' : r.sort ?? ''} onChange={e => {
        routing({ order: undefined, sort: e.target.value === 'order' || e.target.value === '' ? undefined : e.target.value as typeof r.sort });
        setSlugs(prev => ({ ...prev, order: '' }));
      }}>
        <option value=''>{label('automatic')}</option><option value='order'>{label('order')}</option><option value='price'>{label('price')}</option><option value='throughput'>{label('throughput')}</option><option value='latency'>{label('latency')}</option>
      </select>
    </label>
    {(['order', 'only', 'ignore'] as const).map(name => <label key={name}>{label(name)}
      <input className={fieldClass} value={slugs[name]} placeholder='anthropic, google-vertex' onChange={e => {
        const text = e.target.value;
        setSlugs(prev => ({ ...prev, [name]: text }));
        const list = [...new Set(text.split(',').map(v => v.trim()).filter(Boolean))];
        routing({ [name]: list.length ? list : undefined, ...(name === 'order' && list.length ? { sort: undefined } : {}) });
      }} />
    </label>)}
    <p className='text-xs text-gray-500'>{label('slugHelp')}</p>
    {triState('allow_fallbacks')}{triState('require_parameters')}
    <div className='grid grid-cols-2 gap-3'>{(['prompt', 'completion'] as const).map(name => <label key={name}>{label(`${name}Price`)}
      <input type='number' min='0' step='any' className={fieldClass} value={r.max_price?.[name] ?? ''} onChange={e => routing({ max_price: { ...r.max_price, [name]: e.target.value === '' ? undefined : e.target.valueAsNumber } })} />
    </label>)}</div>
    <label>{label('data_collection')}
      <select className={fieldClass} value={r.data_collection ?? ''} onChange={e => routing({ data_collection: e.target.value === '' ? undefined : e.target.value as 'allow' | 'deny' })}>
        <option value=''>{label('inherit')}</option><option value='allow'>{label('allow')}</option><option value='deny'>{label('deny')}</option>
      </select>
    </label>
    <label className='flex gap-2 items-center'><input type='checkbox' checked={r.zdr === true} onChange={e => onChange({ ...settings, routing: { ...r, zdr: e.target.checked ? true : undefined }, ...(e.target.checked ? { responseCache: { mode: 'off' } } : {}) })} />{label('zdr')}</label>
    <p className='text-xs text-gray-500'>{label('zdrHelp')}</p>
    <label>{label('promptCache')}
      <select className={fieldClass} value={settings.promptCache?.mode ?? 'provider-default'} onChange={e => onChange({ ...settings, promptCache: { mode: e.target.value as NonNullable<OpenRouterChatSettings['promptCache']>['mode'], ttl: settings.promptCache?.ttl } })}>
        <option value='provider-default'>{label('providerDefault')}</option>
        <option value='claude-conversation' disabled={!isClaude}>{label('claudeConversation')}</option>
        <option value='claude-system' disabled={!isClaude}>{label('claudeSystem')}</option>
      </select>
    </label>
    <p className='text-xs text-gray-500'>{label(isClaude ? 'cacheUnknown' : 'cacheUnsupported')}</p>
    {settings.promptCache && settings.promptCache.mode !== 'provider-default' && <label>{label('promptTTL')}
      <select className={fieldClass} value={settings.promptCache.ttl ?? '5m'} onChange={e => onChange({ ...settings, promptCache: { ...settings.promptCache!, ttl: e.target.value as '5m' | '1h' } })}>
        <option value='5m'>{label('fiveMinutes')}</option><option value='1h'>{label('oneHour')}</option>
      </select>
    </label>}
    <label>{label('responseCache')}
      <select className={fieldClass} disabled={r.zdr === true} value={settings.responseCache?.mode ?? 'inherit'} onChange={e => onChange({ ...settings, responseCache: { mode: e.target.value as 'inherit' | 'off' | 'on', ttlSeconds: settings.responseCache?.ttlSeconds } })}>
        <option value='inherit'>{label('inherit')}</option><option value='off'>{label('off')}</option><option value='on'>{label('on')}</option>
      </select>
    </label>
    {settings.responseCache?.mode === 'on' && <label>{label('responseTTL')}
      <input type='number' min='1' max='86400' step='1' className={fieldClass} value={settings.responseCache.ttlSeconds ?? 300} onChange={e => onChange({ ...settings, responseCache: { ...settings.responseCache!, ttlSeconds: e.target.value === '' ? undefined : e.target.valueAsNumber } })} />
    </label>}
    <p className='text-xs text-gray-500'>{label('responseHelp')}</p>
    <label className='flex gap-2 items-center'><input type='checkbox' checked={settings.stickySession === true} onChange={e => onChange({ ...settings, stickySession: e.target.checked })} />{label('stickySession')}</label>
    <p className='text-xs text-gray-500'>{label('constraintsHelp')}</p>
    <a className='text-xs underline' href='https://openrouter.ai/docs/guides/routing/provider-selection' target='_blank' rel='noreferrer'>{label('documentation')}</a>
    {error && <p role='alert' className='text-sm text-red-500'>{t(error)}</p>}
  </fieldset>;
}
