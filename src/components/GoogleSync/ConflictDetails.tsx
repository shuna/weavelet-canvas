import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@store/storage/google/records';
import { useSyncReview } from '@store/storage/google/conflicts';
import { getGoogleSyncCloudReview } from '@store/storage/GoogleCloudStorage';
import { getBranchMessages, getConflictContext } from './conflictContext';

const ConflictDetails = ({ conflictKey, localSnapshot }: { conflictKey: string; localSnapshot: Snapshot }) => {
  const { t } = useTranslation('drive');
  const cloudReview = useSyncReview(state => state.cloudReview);
  const [side, setSide] = useState<'local' | 'cloud'>('local');
  const [versionId, setVersionId] = useState('');
  const [branchId, setBranchId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const targetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (cloudReview) return;
    let cancelled = false;
    setFailed(false);
    void getGoogleSyncCloudReview().then(
      review => { if (!cancelled) useSyncReview.setState({ cloudReview: review }); },
      () => { if (!cancelled) setFailed(true); }
    );
    return () => { cancelled = true; };
  }, [cloudReview, attempt]);
  const snapshot = side === 'local' ? localSnapshot : cloudReview?.versions.find(version => version.id === versionId)?.snapshot ?? cloudReview?.snapshot;
  const context = snapshot && getConflictContext(snapshot, conflictKey);
  const messages = snapshot ? getBranchMessages(snapshot, conflictKey, branchId) : [];
  const branch = context?.branches.find(branch => branch.id === branchId) ?? context?.preferredBranch;
  const target = messages.find(message => message.target);
  useEffect(() => { targetRef.current?.scrollIntoView({ block: 'center' }); }, [side, versionId, branch?.id, conflictKey]);
  const switchSide = (next: 'local' | 'cloud') => { setSide(next); };
  return <section className='flex h-[60vh] min-h-0 w-full max-w-2xl flex-col text-left' aria-label={t('details.title') as string}>
    {context?.chat && <p className='shrink-0 break-words font-semibold'>{context.chat.title}</p>}
    <div className='mt-3 flex shrink-0 gap-1 rounded border border-gray-300 p-1 dark:border-gray-600' role='group' aria-label={t('details.side') as string}>
      {(['local', 'cloud'] as const).map(value => <button key={value} type='button' aria-pressed={side === value} onClick={() => switchSide(value)} className={`flex-1 rounded px-3 py-1.5 text-sm ${side === value ? 'bg-gray-200 font-medium text-gray-900 dark:bg-gray-600 dark:text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600/50'}`}>{t(value === 'local' ? 'conflict.device' : 'overview.cloud')}</button>)}
    </div>
    {side === 'cloud' && cloudReview && cloudReview.versions.length > 1 && <label className='mt-3 flex shrink-0 items-center gap-2 text-xs'>
      {t('details.cloudVersion')}
      <select aria-label={t('details.cloudVersion') as string} className='min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-700' value={versionId} onChange={event => setVersionId(event.target.value)}>
        <option value=''>{t('details.combined')}</option>
        {cloudReview.versions.map((version, index) => <option key={version.id} value={version.id}>{t('details.version', { number: index + 1 })}</option>)}
      </select>
    </label>}
    {context?.chat && <div className='mt-3 shrink-0 text-xs'>
      {context.branches.length > 0 ? <label className='flex items-center gap-2'>{t('details.branch')}
        <select aria-label={t('details.branch') as string} className='min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-700' value={branch?.id ?? ''} onChange={event => setBranchId(event.target.value)}>
          {context.branches.map((branch, index) => <option key={branch.id} value={branch.id}>{t('details.branchNumber', { number: index + 1 })}{branch.label ? `：${branch.label}` : ''} · {t('details.messageCount', { count: branch.nodeIds.length })}</option>)}
        </select>
      </label> : <p>{t('details.legacy')}</p>}
      <p className='mt-2 text-gray-500 dark:text-gray-300'>{context.nodeId ? target ? t('details.bubblePosition', { number: target.position }) : t('details.bubbleMissing') : t('details.wholeChat')}</p>
    </div>}
    <div className='mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-gray-300 py-3 dark:border-gray-600' role='region' aria-label={t('details.contents') as string} tabIndex={0}>
      {!snapshot ? <p role='status'>{t(failed ? 'details.failed' : 'overview.loading')}{failed && <button type='button' className='ml-2 underline' onClick={() => setAttempt(value => value + 1)}>{t('overview.retry')}</button>}</p> : context?.path[0] === 'chats' && !context.chat ? <p>{t('details.chatMissing')}</p> : <>
        {context && !context.nodeId && context.value !== undefined && (!context.chat || (context.path.length > 2 && !['messages', 'branchTree'].includes(context.path[2]))) && <div className='mb-3 text-xs'>
          <h5 className='font-medium'>{t(`conflict.fields.${context.path.at(-1)}`, { defaultValue: t('conflict.otherField') })}</h5>
          <pre className='mt-1 whitespace-pre-wrap break-words font-sans'>{typeof context.value === 'string' ? context.value : JSON.stringify(context.value, null, 2)}</pre>
        </div>}
        {messages.map(message => <article key={message.id} ref={message.target ? targetRef : undefined} className={`mb-3 rounded border p-3 text-sm last:mb-0 ${message.target ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-300 bg-white/50 dark:border-gray-600 dark:bg-gray-800/30'}`}>
          <h5 className='mb-2 text-xs font-medium text-gray-600 dark:text-gray-300'>{t('details.messagePosition', { number: message.position })} · {t(`details.roles.${message.role}`)}{message.target && <span className='ml-2 text-amber-700 dark:text-amber-300'>{t('details.target')}</span>}</h5>
          {message.content.length === 0 ? <p className='text-xs text-gray-500 dark:text-gray-400'>{t('details.empty')}</p> : message.content.map((part, index) => <div key={index} className='mb-2 whitespace-pre-wrap break-words last:mb-0'>
            {part.type === 'image_url' ? <img src={part.image_url.url} alt={t('details.image') as string} loading='lazy' referrerPolicy='no-referrer' className='max-h-64 max-w-full rounded' /> : part.type === 'tool_call' ? <><p className='text-xs'>{part.name}</p>{part.arguments}</> : part.type === 'tool_result' ? part.content : part.text}
          </div>)}
        </article>)}
        {context && context.path[0] !== 'chats' && context.value === undefined && <p>{t('details.itemMissing')}</p>}
      </>}
    </div>
    <p className='mt-2 shrink-0 text-xs text-gray-500 dark:text-gray-400'>{t('details.readOnly')}</p>
  </section>;
};

export default ConflictDetails;
