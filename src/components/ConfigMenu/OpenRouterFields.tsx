import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenRouterChatSettings } from '@type/chat';
import { validateOpenRouterSettings } from '@utils/openrouterControls';
import { defaultOpenRouterSettings } from '@utils/modelSettings';
import useStore from '@store/store';
import { FieldLabelWithInfo, InfoTooltip, ResetButton } from './fields';

export default function OpenRouterFields({ value, onChange, model, isDefault = false, streamEnabled = true }: {
  value?: OpenRouterChatSettings;
  onChange: (value: OpenRouterChatSettings) => void;
  model: string;
  isDefault?: boolean;
  streamEnabled?: boolean;
}) {
  const { t } = useTranslation('model');
  const proxyAvailable = useStore(state => state.proxyEnabled && !!state.proxyEndpoint?.trim());
  const responseCacheAvailable = proxyAvailable && streamEnabled;
  const [expanded, setExpanded] = useState(false);
  const [providers, setProviders] = useState<{ slug: string; name: string }[]>([]);
  const [providerError, setProviderError] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    fetch('https://openrouter.ai/api/v1/providers', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error('Invalid provider list');
        setProviders(payload.data.filter((p: { slug?: unknown; name?: unknown }) =>
          typeof p?.slug === 'string' && typeof p?.name === 'string'
        ).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)));
        setProviderError(false);
      }).catch(() => { if (!controller.signal.aborted) setProviderError(true); });
    return () => controller.abort();
  }, [expanded]);
  const settings = value ?? {};
  const r = settings.routing ?? {};
  const [slugs, setSlugs] = useState({ order: r.order?.join(', ') ?? '', only: r.only?.join(', ') ?? '', ignore: r.ignore?.join(', ') ?? '' });
  const routing = (patch: Partial<NonNullable<OpenRouterChatSettings['routing']>>) => onChange({ ...settings, routing: { ...r, ...patch } });
  const fieldClass = 'w-full rounded border border-gray-400/50 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 px-2 py-1.5 text-sm disabled:text-gray-400 dark:disabled:text-gray-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed';
  const label = (name: string) => t(`openRouter.${name}`) as string;
  const error = validateOpenRouterSettings(value, model, responseCacheAvailable);
  const isClaude = model.startsWith('anthropic/claude-');
  const description = (name: string) => {
    const existing: Record<string, string> = { order: 'slugHelp', only: 'slugHelp', ignore: 'slugHelp', require_parameters: 'requireParametersHelp', zdr: 'zdrHelp', promptCache: isClaude ? 'cacheUnknown' : 'cacheUnsupported', responseCache: 'responseHelp' };
    return [label(existing[name] ?? `help.${name}`),
      ...(['responseCache', 'responseTTL'].includes(name) ? [!proxyAvailable ? label('directCacheDisabled') : !streamEnabled ? label('nonStreamingCacheDisabled') : r.zdr ? label('zdrCacheDisabled') : ''] : []),
      ...(name === 'promptTTL' && !isClaude ? [label('cacheUnsupported')] : []),
      ...(['order', 'only', 'ignore'].includes(name) && providerError ? [label('providerLoadError')] : []),
    ].filter(Boolean).join(' ');
  };
  const fieldLabel = (name: string, reset: () => void, disabled = false) => <FieldLabelWithInfo description={description(name)} onReset={reset} disabled={disabled}>{label(name)}</FieldLabelWithInfo>;
  const setSlug = (name: 'order' | 'only' | 'ignore', text: string) => {
    const list = [...new Set(text.split(',').map(v => v.trim()).filter(Boolean))];
    setSlugs(prev => ({ ...prev, [name]: text }));
    routing({ [name]: list.length ? list : undefined, ...(name === 'order' && list.length ? { sort: undefined } : {}) });
  };
  const switchField = (name: string, checked: boolean, change: (checked: boolean) => void, reset: () => void) => (
    <div className='flex items-center gap-3'>
      {fieldLabel(name, reset)}
      <button type='button' role='switch' aria-label={label(name)} aria-checked={checked}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-400 dark:bg-gray-600'}`}
        onClick={() => change(!checked)}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
  const triState = (name: 'allow_fallbacks' | 'require_parameters') => (
    <div>{fieldLabel(name, () => routing({ [name]: undefined }))}
      <select aria-label={label(name)} className={fieldClass} value={r[name] === undefined ? '' : String(r[name])} onChange={e => routing({ [name]: e.target.value === '' ? undefined : e.target.value === 'true' })}>
        <option value=''>{label('inherit')}</option><option value='true'>{label('yes')}</option><option value='false'>{label('no')}</option>
      </select>
    </div>
  );
  return <fieldset className='rounded-lg border border-gray-300 dark:border-gray-600 p-4 text-gray-900 dark:text-white'>
    <legend className='px-1 font-medium'>
      <button type='button' aria-expanded={expanded} onClick={() => setExpanded(v => !v)} className='inline-flex items-center gap-2'>
        <span aria-hidden='true'>{expanded ? '▾' : '▸'}</span>OpenRouter
      </button>
      <InfoTooltip text={<>{label(isDefault ? 'defaultScope' : 'scope')} {label('constraintsHelp')} <a className='underline' href='https://openrouter.ai/docs/guides/routing/provider-selection' target='_blank' rel='noreferrer'>{label('documentation')}</a></>} />
      <span className='ml-3'><ResetButton onClick={() => { onChange({ ...defaultOpenRouterSettings(), ...(!responseCacheAvailable ? { responseCache: settings.responseCache } : {}) }); setSlugs({ order: '', only: '', ignore: '' }); }} /></span>
    </legend>
    {expanded && <div className='flex flex-col gap-3'>
      <div>{fieldLabel('selection', () => { routing({ order: undefined, sort: undefined }); setSlugs(prev => ({ ...prev, order: '' })); })}
        <select aria-label={label('selection')} className={fieldClass} value={r.order?.length ? 'order' : r.sort ?? ''} onChange={e => {
          routing({ order: undefined, sort: e.target.value === 'order' || e.target.value === '' ? undefined : e.target.value as typeof r.sort });
          setSlugs(prev => ({ ...prev, order: '' }));
        }}>
          <option value=''>{label('automatic')}</option><option value='order'>{label('order')}</option><option value='price'>{label('price')}</option><option value='throughput'>{label('throughput')}</option><option value='latency'>{label('latency')}</option>
        </select>
      </div>
      {(['order', 'only', 'ignore'] as const).map(name => <div key={name}>
        {fieldLabel(name, () => setSlug(name, ''))}
        <select aria-label={label(name) + ' — ' + label('chooseProvider')} className={fieldClass + ' mb-1'} value='' onChange={e => {
          if (e.target.value) setSlug(name, [...new Set([...slugs[name].split(',').map(v => v.trim()).filter(Boolean), e.target.value])].join(', '));
        }}>
          <option value=''>{label('chooseProvider')}</option>
          {providers.map(p => <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>)}
        </select>
        <input aria-label={label(name)} className={fieldClass} value={slugs[name]} placeholder='anthropic, google-vertex' onChange={e => setSlug(name, e.target.value)} />
      </div>)}
      {triState('allow_fallbacks')}{triState('require_parameters')}
      <div className='grid grid-cols-2 gap-3'>{(['prompt', 'completion'] as const).map(name => <div key={name}>{fieldLabel(`${name}Price`, () => routing({ max_price: { ...r.max_price, [name]: undefined } }))}
        <input aria-label={label(`${name}Price`)} type='number' min='0' step='any' className={fieldClass} value={r.max_price?.[name] ?? ''} onChange={e => routing({ max_price: { ...r.max_price, [name]: e.target.value === '' ? undefined : e.target.valueAsNumber } })} />
      </div>)}</div>
      <div>{fieldLabel('data_collection', () => routing({ data_collection: undefined }))}
        <select aria-label={label('data_collection')} className={fieldClass} value={r.data_collection ?? ''} onChange={e => routing({ data_collection: e.target.value === '' ? undefined : e.target.value as 'allow' | 'deny' })}>
          <option value=''>{label('inherit')}</option><option value='allow'>{label('allow')}</option><option value='deny'>{label('deny')}</option>
        </select>
      </div>
      {switchField('zdr', r.zdr === true, checked => onChange({ ...settings, routing: { ...r, zdr: checked ? true : undefined }, ...(checked && responseCacheAvailable ? { responseCache: { mode: 'off' } } : {}) }), () => routing({ zdr: undefined }))}
      <div>{fieldLabel('promptCache', () => onChange({ ...settings, promptCache: undefined }))}
        <select aria-label={label('promptCache')} className={fieldClass} value={settings.promptCache?.mode ?? 'provider-default'} onChange={e => onChange({ ...settings, promptCache: { mode: e.target.value as NonNullable<OpenRouterChatSettings['promptCache']>['mode'], ttl: settings.promptCache?.ttl } })}>
          <option value='provider-default'>{label('providerDefault')}</option>
          <option value='claude-conversation' disabled={!isClaude}>{label('claudeConversation')}</option>
          <option value='claude-system' disabled={!isClaude}>{label('claudeSystem')}</option>
        </select>
      </div>
      {settings.promptCache && settings.promptCache.mode !== 'provider-default' && <div>{fieldLabel('promptTTL', () => onChange({ ...settings, promptCache: { ...settings.promptCache!, ttl: undefined } }), !isClaude)}
        <select disabled={!isClaude} aria-label={label('promptTTL')} className={fieldClass} value={settings.promptCache.ttl ?? '5m'} onChange={e => onChange({ ...settings, promptCache: { ...settings.promptCache!, ttl: e.target.value as '5m' | '1h' } })}>
          <option value='5m'>{label('fiveMinutes')}</option><option value='1h'>{label('oneHour')}</option>
        </select>
      </div>}
      <div>{fieldLabel('responseCache', () => onChange({ ...settings, responseCache: { mode: 'off' } }), !responseCacheAvailable || r.zdr === true)}
        <select aria-label={label('responseCache')} className={fieldClass} disabled={!responseCacheAvailable || r.zdr === true} value={settings.responseCache?.mode ?? 'inherit'} onChange={e => onChange({ ...settings, responseCache: { mode: e.target.value as 'inherit' | 'off' | 'on', ttlSeconds: settings.responseCache?.ttlSeconds } })}>
          <option value='inherit'>{label('inherit')}</option><option value='off'>{label('off')}</option><option value='on'>{label('on')}</option>
        </select>
      </div>
      {settings.responseCache?.mode === 'on' && <div>{fieldLabel('responseTTL', () => onChange({ ...settings, responseCache: { ...settings.responseCache!, ttlSeconds: undefined } }), !responseCacheAvailable || r.zdr === true)}
        <input disabled={!responseCacheAvailable || r.zdr === true} aria-label={label('responseTTL')} type='number' min='1' max='86400' step='1' className={fieldClass} value={settings.responseCache.ttlSeconds ?? 300} onChange={e => onChange({ ...settings, responseCache: { ...settings.responseCache!, ttlSeconds: e.target.value === '' ? undefined : e.target.valueAsNumber } })} />
      </div>}
      {switchField('stickySession', settings.stickySession === true, checked => onChange({ ...settings, stickySession: checked }), () => onChange({ ...settings, stickySession: true }))}
    </div>}
    {error && <p role='alert' className='text-sm text-red-500'>{t(error)}</p>}
  </fieldset>;
}
