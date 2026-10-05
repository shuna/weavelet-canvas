import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PopupModal from '@components/PopupModal';
import useStore from '@store/store';
import { isLocalModelConfig } from '@hooks/submitHelpers';
import { isSummaryEligible } from '@utils/bubbleSummary';
import { BubbleSummary, isTextContent } from '@type/chat';
import { useBubbleSummary } from './bubbleSummaryDisplay';

import SyncDots from '@components/GoogleSync/SyncDots';
import { startBubbleSummary, useBubbleSummaryJob, useSummaryGeneration } from './bubbleSummaryGeneration';

export default function BubbleSummaryControls({ messageIndex }: { messageIndex: number }) {
  const [open, setOpen] = useState(false);
  const nodeId = useStore(state => state.chats?.[state.currentChatIndex]?.branchTree?.activePath[messageIndex]);
  const { chat, summary, range, tab, changeTab, effectiveChat, generating } = useBubbleSummary(nodeId);
  const job = useBubbleSummaryJob(chat?.id, nodeId);
  const target = !!chat?.summaryTargets?.[nodeId ?? String(messageIndex)];
  const canSelect = !!chat && isSummaryEligible(chat.messages[messageIndex]) && !effectiveChat?.omittedNodes?.[nodeId ?? String(messageIndex)] && !generating.includes(nodeId ?? '');
  const buttonClass = (active: boolean) => `rounded-full px-2 py-1 text-xs transition-colors ${active ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`;
  return <>
    <div role='group' aria-label='要約操作' className='flex items-center gap-0.5 rounded-full bg-white/80 px-1.5 py-0.5 shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-gray-800/80 dark:ring-white/10'>
    {summary ? <>
      <button type='button' className={buttonClass(tab === 'original')} aria-pressed={tab === 'original'} onClick={event => { event.stopPropagation(); changeTab('original'); }}>原文</button>
      <button type='button' hidden={!!job?.busy} className={buttonClass(tab === 'summary')} aria-pressed={tab === 'summary'} onClick={event => { event.stopPropagation(); if (range && tab === 'original') changeTab('summary'); else setOpen(true); }}>要約</button>
      {job?.busy && <span role='status' className='flex items-center text-xs text-gray-500 dark:text-gray-400'>要約中<SyncDots label='要約生成中' /></span>}
    </> : <>
      <button type='button' hidden={!!job?.busy} className={buttonClass(target)} aria-pressed={target} disabled={!target && !canSelect} aria-label={target ? '要約対象から外す' : '要約に含める'} title={target ? '要約対象から外す' : '要約に含める'} onClick={event => { event.stopPropagation(); useStore.getState().toggleSummaryTarget(useStore.getState().currentChatIndex, messageIndex); }}>要約</button>
      {job?.busy && <span role='status' className='flex items-center text-xs text-gray-500 dark:text-gray-400'>要約中<SyncDots label='要約生成中' /></span>}
      <button type='button' className={buttonClass(false)} onClick={event => { event.stopPropagation(); setOpen(true); }} aria-label='要約を作成'>要約を作成</button>
    </>}
    {job?.error && <button type='button' className='px-1 text-xs text-gray-500 dark:text-gray-400' title={job.error} onClick={event => { event.stopPropagation(); setOpen(true); }}>要約失敗</button>}
    </div>
    {open && <SummaryDialog messageIndex={summary ? chat?.branchTree?.activePath.indexOf(summary.sources[summary.sources.length - 1]?.nodeId) ?? -1 : messageIndex} initialSummary={summary} setOpen={setOpen} />}
  </>;
}

function SummaryDialog({ messageIndex, initialSummary, setOpen }: { messageIndex: number; initialSummary?: BubbleSummary; setOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const { t } = useTranslation();
  const initialChat = useRef(useStore.getState().chats?.[useStore.getState().currentChatIndex]).current;
  const chat = useStore(state => state.chats?.find(value => value.id === initialChat?.id));
  const omittedMaps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const endpoint = initialChat?.branchTree?.activePath[messageIndex];
  const job = useBubbleSummaryJob(initialChat?.id, endpoint);
  const [mode, setMode] = useState<BubbleSummary['mode']>(job ? job.mode : initialSummary?.mode ?? 'single');
  const [selected, setSelected] = useState<string[]>(() => job ? job.sourceNodeIds : initialSummary ? initialSummary.sources.map(source => source.nodeId) : endpoint ? [endpoint] : []);
  const busy = !!job?.busy;
  const close = () => setOpen(false);
  if (!chat?.branchTree) return null;
  const path = chat.branchTree.activePath;
  const endIndex = endpoint ? path.indexOf(endpoint) : -1;
  const currentIndex = useStore.getState().chats?.findIndex(value => value.id === chat.id) ?? -1;
  const effectiveChat = { ...chat, omittedNodes: omittedMaps[String(currentIndex)] ?? chat.omittedNodes };
  const generating = Object.values(sessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId);
  const candidate = (index: number) => mode === 'range' || (mode === 'single' ? path[index] === endpoint : index <= endIndex);
  const eligible = (index: number) => isSummaryEligible(chat.messages[index]) && !effectiveChat.omittedNodes?.[path[index]] && !generating.includes(path[index]);
  const chooseMode = (next: BubbleSummary['mode']) => {
    setMode(next);
    setSelected(next === 'single' ? endpoint ? [endpoint] : [] : next === 'through'
      ? path.slice(0, endIndex + 1).filter((_, index) => chat.messages[index]?.role !== 'system')
      : path.filter(id => chat.summaryTargets?.[id]));
  };
  const indices = path.map((id, index) => selected.includes(id) ? index : -1).filter(index => index >= 0);
  const continuous = indices.length > 0 && indices.length === selected.length && indices[indices.length - 1] - indices[0] + 1 === indices.length;
  const valid = continuous && indices.every(index => eligible(index) && candidate(index)) && (mode !== 'single' || indices.length === 1);
  const local = isLocalModelConfig(chat.config);
  const reason = local ? 'ローカルモデルでは要約生成を利用できません。' : !chat.config.model ? 'チャットのモデルを選択してください。' : !selected.length ? '要約するバブルを選択してください。' : !valid ? '同じ経路の連続した通常テキストを選択してください。不可視・画像・ツール・生成中のバブルは対象外です。' : '';
  const generate = () => {
    if (busy || reason) return;
    const state = useStore.getState();
    void startBubbleSummary(effectiveChat, indices, mode, endpoint!, { favoriteModels: state.favoriteModels, providers: state.providers, fallbackProvider: { endpoint: state.apiEndpoint, key: state.apiKey }, apiVersion: state.apiVersion, t });
    if (useSummaryGeneration.getState().jobs[`${chat.id}:${endpoint}`]?.busy) setOpen(false);
  };
  return <PopupModal title='要約の対象を選択' setIsModalOpen={setOpen} handleClose={close} handleClickBackdrop={close} cancelButton={false}
    footerEndContent={<><button type='button' className='btn btn-neutral' onClick={close}>{busy ? '閉じる' : 'キャンセル'}</button><button type='button' className={`btn ${busy || reason ? 'btn-neutral cursor-not-allowed opacity-50' : 'btn-primary'}`} disabled={busy || !!reason} onClick={() => void generate()}>{busy ? '生成中…' : '要約を生成'}</button></>}>
    <div className='min-w-[18rem] space-y-3 p-5 text-sm text-gray-900 dark:text-gray-300'>
      <div className='flex flex-wrap gap-3'>{(['single', 'through', 'range'] as const).map(value => <label key={value} className='flex cursor-pointer items-center gap-1 text-gray-600 dark:text-gray-400'><input type='radio' className='accent-blue-600' name='summary-mode' checked={mode === value} disabled={busy} onChange={() => chooseMode(value)} />{value === 'single' ? 'このバブル' : value === 'through' ? 'ここまで' : '選択範囲'}</label>)}</div>
      <p className='text-xs text-gray-500 dark:text-gray-400'>原文は保持されます。生成後は要約を表示・送信します。「原文」で原文の表示・送信に戻せます。先頭のシステム指示は要約しません。</p>
      <div className='max-h-72 space-y-2 overflow-y-auto'>{path.map((id, index) => <label key={id} className={`flex items-start gap-2 rounded border p-2 ${selected.includes(id) && eligible(index) && candidate(index) ? 'border-gray-300 text-gray-900 dark:border-gray-500 dark:text-gray-300' : 'border-gray-200 text-gray-400 dark:border-gray-600 dark:text-gray-500'}`}>
        <input type='checkbox' className='mt-0.5 accent-blue-600' aria-label={`バブル${index + 1}を要約に含める`} checked={selected.includes(id)} disabled={busy || !candidate(index) || (!eligible(index) && !selected.includes(id))} onChange={() => {
          setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
          if (mode === 'range') {
            const current = useStore.getState(); const targetIndex = current.chats?.findIndex(value => value.id === chat.id) ?? -1;
            if (!!current.chats?.[targetIndex]?.summaryTargets?.[id] !== !selected.includes(id)) current.toggleSummaryTarget(targetIndex, index);
          }
        }} />
        <span><strong>{index + 1}. {chat.messages[index]?.role === 'user' ? 'ユーザー' : chat.messages[index]?.role === 'assistant' ? 'アシスタント' : 'システム'}</strong><span className='block whitespace-pre-wrap break-words text-xs'>{chat.messages[index]?.content.filter(isTextContent).map(value => value.text).join('\n').slice(0, 240)}</span></span>
      </label>)}</div>
      <p aria-live='polite' className='text-xs text-gray-500 dark:text-gray-400'>{job?.error || reason || `対象 ${selected.length}件`}</p>
    </div>
  </PopupModal>;
}
