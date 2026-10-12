import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@store/storage/google/records';
import { useSyncReview } from '@store/storage/google/conflicts';
import { getGoogleSyncCloudReview } from '@store/storage/GoogleCloudStorage';
import { formatSettingValue, getBranchMessages, getConflictContext } from './conflictContext';

const ConflictDetails = ({ conflictKey, localSnapshot }: { conflictKey: string; localSnapshot: Snapshot }) => {
  const { t, i18n } = useTranslation('drive');
  const settingLabel = (field: string) => t(`settingsFields.${field}`, { defaultValue: field });
  const cloudReview = useSyncReview(state => state.cloudReview);
  const [versionId, setVersionId] = useState('');
  const [branchId, setBranchId] = useState<Record<number, string>>({});
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
  const localContext = getConflictContext(localSnapshot, conflictKey);
  const path = localContext.path;
  const cloudSnapshot = cloudReview?.versions.find(version => version.id === versionId)?.snapshot ?? cloudReview?.snapshot;
  const fieldLabel = (field: string) => t(`conflict.fields.${field}`, { defaultValue: settingLabel(field) });
  const isChat = path[0] === 'chats';
  const isFolder = path[0] === 'state' && path[1] === 'folders';
  const title = isChat ? fieldLabel(localContext.nodeId ? 'contentHash' : path.at(-1) ?? 'chat') : fieldLabel(path.at(-1) ?? '');
  useEffect(() => { targetRef.current?.scrollIntoView({ block: 'center' }); }, [versionId, branchId, conflictKey]);
  return <section className='flex h-[60vh] min-h-0 w-full max-w-2xl flex-col text-left' aria-label={t('details.title') as string}>
    <h5 className='mt-3 shrink-0 text-sm font-semibold'>{title}</h5>
    {cloudReview && cloudReview.versions.length > 1 && <label className='mt-3 flex shrink-0 items-center gap-2 text-xs'>
      {t('details.cloudVersion')}
      <select aria-label={t('details.cloudVersion') as string} className='min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-700' value={versionId} onChange={event => setVersionId(event.target.value)}>
        <option value=''>{t('details.combined')}</option>
        {cloudReview.versions.map((version, index) => <option key={version.id} value={version.id}>{t('details.version', { number: index + 1 })}</option>)}
      </select>
    </label>}
    <div className='mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-gray-300 py-3 dark:border-gray-600' role='region' aria-label={t('details.contents') as string} tabIndex={0}>
      {['pendingVerifications', 'verifiedStats'].includes(path[1]) && <p className='mb-3 text-xs text-gray-500 dark:text-gray-300'>{t('details.verificationHelp')}</p>}
      <table className='w-full table-fixed border-collapse text-sm'>
        <caption className='sr-only'>{t('details.valueComparison')}</caption>
        <thead><tr>{['conflict.device', 'overview.cloud'].map(key => <th key={key} scope='col' className='sticky top-0 z-10 border border-gray-300 bg-gray-100 px-2 py-2 text-left font-medium dark:border-gray-600 dark:bg-gray-700'>{t(key)}</th>)}</tr></thead>
        <tbody><tr>{[localSnapshot, cloudSnapshot].map((source, index) => {
          const context = source && getConflictContext(source, conflictKey);
          const branch = context?.branches.find(branch => branch.id === branchId[index]) ?? context?.preferredBranch;
          const messages = source ? getBranchMessages(source, conflictKey, branch?.id) : [];
          const folder = isFolder ? source?.state.folders?.[path[2]] : undefined;
          const value = context?.value;
          const display = formatSettingValue(path, value, key => t(`settingsValues.${key}`), i18n.language);
          const raw = typeof value === 'string' ? value : JSON.stringify(value);
          return <td key={index} className='align-top border border-gray-300 px-2 py-3 dark:border-gray-600'>
            {!source ? <p role='status'>{t(failed ? 'details.failed' : 'overview.loading')}{failed && <button type='button' className='mt-2 underline' onClick={() => setAttempt(value => value + 1)}>{t('overview.retry')}</button>}</p> : <>
              <ol className='mb-3 space-y-1 border-l border-gray-300 pl-2 text-xs dark:border-gray-600' aria-label={t('details.settingLocation') as string}>
                {isChat ? <>
                  <li className='break-words'>{t('conflict.chat')}：{context?.chat?.title ?? path[1]}</li>
                  {context?.nodeId && <li className='break-all pl-2'>{t('settingsFields.targetNodeId')}：{context.nodeId}</li>}
                  <li className='pl-2'>{title}</li>
                </> : isFolder ? <>
                  <li>{t('conflict.folder')}</li><li className='break-words pl-2'>{folder?.name ?? path[2]}</li><li className='pl-4'>{fieldLabel(path.at(-1) ?? '')}</li>
                </> : path.slice(1).map((part, level) => {
                  const [chatId, nodeId] = part.split(':::');
                  const chat = nodeId ? source.state.chats?.find(chat => chat.id === chatId) : undefined;
                  return <li key={level} className='break-words' style={{ paddingLeft: level * 8 }}>{nodeId ? <><span className='block'>{t(chat ? 'conflict.chat' : 'settingsFields.chatId')}：{chat?.title ?? chatId}</span><span className='block'>{t('settingsFields.targetNodeId')}：{nodeId}</span></> : settingLabel(part)}</li>;
                })}
              </ol>
              {isChat && !context?.chat ? <p>{t('details.chatMissing')}</p> : <>
                {context?.chat && <div className='mb-3 text-xs'>
                  {context.branches.length > 0 ? <label className='block'>{t('details.branch')}
                    <select aria-label={`${t(index === 0 ? 'conflict.device' : 'overview.cloud')} ${t('details.branch')}`} className='mt-1 w-full min-w-0 rounded border border-gray-300 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-700' value={branch?.id ?? ''} onChange={event => setBranchId(previous => ({ ...previous, [index]: event.target.value }))}>
                      {context.branches.map((entry, number) => <option key={entry.id} value={entry.id}>{t('details.branchNumber', { number: number + 1 })}{entry.label ? `：${entry.label}` : ''} · {t('details.messageCount', { count: entry.nodeIds.length })}</option>)}
                    </select>
                  </label> : <p>{t('details.legacy')}</p>}
                  <p className='mt-2 text-gray-500 dark:text-gray-300'>{context.nodeId ? messages.some(message => message.target) ? t('details.bubblePosition', { number: messages.find(message => message.target)!.position }) : t('details.bubbleMissing') : t('details.wholeChat')}</p>
                </div>}
                {(!isChat || (path.length > 2 && !['messages', 'branchTree'].includes(path[2])) || (context?.nodeId && path.at(-1) !== 'contentHash')) && <>
                  <p className='whitespace-pre-wrap break-words'>{value === undefined ? t('details.itemMissing') : display}</p>
                  {value !== undefined && display !== raw && <p className='mt-2 break-all text-xs text-gray-500 dark:text-gray-400'>{t('details.storedValue')}：{raw}</p>}
                </>}
                {messages.map(message => <article key={message.id} ref={index === 0 && message.target ? targetRef : undefined} className={`mb-3 rounded border p-2 text-sm last:mb-0 ${message.target ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-300 bg-white/50 dark:border-gray-600 dark:bg-gray-800/30'}`}>
                  <h5 className='mb-2 text-xs font-medium text-gray-600 dark:text-gray-300'>{t('details.messagePosition', { number: message.position })} · {t(`details.roles.${message.role}`)}{message.target && <span className='ml-1 text-amber-700 dark:text-amber-300'>{t('details.target')}</span>}</h5>
                  {message.content.length === 0 ? <p className='text-xs text-gray-500 dark:text-gray-400'>{t('details.empty')}</p> : message.content.map((part, partIndex) => <div key={partIndex} className='mb-2 whitespace-pre-wrap break-words last:mb-0'>
                    {part.type === 'image_url' ? <img src={part.image_url.url} alt={t('details.image') as string} loading='lazy' referrerPolicy='no-referrer' className='max-h-64 max-w-full rounded' /> : part.type === 'tool_call' ? <><p className='text-xs'>{part.name}</p>{part.arguments}</> : part.type === 'tool_result' ? part.content : part.text}
                  </div>)}
                </article>)}
              </>}
            </>}
          </td>;
        })}</tr></tbody>
      </table>
    </div>
    <p className='mt-2 shrink-0 text-xs text-gray-500 dark:text-gray-400'>{t('details.readOnly')}</p>
  </section>;
};

export default ConflictDetails;
