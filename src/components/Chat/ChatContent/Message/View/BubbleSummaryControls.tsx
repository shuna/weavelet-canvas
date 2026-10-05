import useSummaryTokenCounts, { summaryTokenLabel } from './useSummaryTokenCounts';
import { InfoTooltip, ResetButton } from '@components/ConfigMenu/fields';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PopupModal from '@components/PopupModal';
import { SummarySettingsFields } from '@components/SummarySettings';
import SettingIcon from '@icon/SettingIcon';
import DownChevronArrow from '@icon/DownChevronArrow';
import useStore from '@store/store';
import { isLocalModelConfig } from '@hooks/submitHelpers';
import { isSummaryEligible } from '@utils/bubbleSummary';
import { BubbleSummary, isTextContent } from '@type/chat';
import { useBubbleSummary } from './bubbleSummaryDisplay';

import SyncDots from '@components/GoogleSync/SyncDots';
import { startBubbleSummary, useBubbleSummaryJob, useSummaryGeneration } from './bubbleSummaryGeneration';

export default function BubbleSummaryControls({ messageIndex }: { messageIndex: number }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dialogFormat, setDialogFormat] = useState<'compact' | undefined>();
  const nodeId = useStore(state => state.chats?.[state.currentChatIndex]?.branchTree?.activePath[messageIndex]);
  const { chat, summary, range, readable, compact, tab, changeTab, effectiveChat, generating } = useBubbleSummary(nodeId);
  const job = useBubbleSummaryJob(chat?.id, nodeId);
  const originals = useMemo(() => chat?.messages.slice(range?.first ?? messageIndex, (range?.last ?? messageIndex) + 1) ?? [], [chat?.messages, range?.first, range?.last, messageIndex]);
  const counts = useSummaryTokenCounts(originals, chat?.config?.model ?? '', range ? readable : undefined, range ? compact : undefined);
  const tokenLabel = (value: 'original' | 'summary' | 'compact') => {
    if (value !== 'original' && !(range && (value === 'summary' ? readable : compact))) return '未処理';
    const tokens = counts?.[value];
    return tokens === undefined ? '計算中…' : summaryTokenLabel(tokens, counts!.original, value === 'original');
  };
  const buttonClass = (active: boolean) => `shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs transition-colors ${active ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'}`;
  const controls = (
      <div role='group' aria-label='要約操作' className='summary-format-options flex gap-0.5 bg-white/80 p-1 shadow-sm ring-1 ring-black/5 dark:bg-gray-800/80 dark:ring-white/10'>
      <button type='button' className={buttonClass(tab === 'original')} aria-pressed={tab === 'original'} onClick={event => { event.stopPropagation(); changeTab('original'); if (menuRef.current) menuRef.current.open = false; }}><svg aria-hidden='true' className='summary-option-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M14 3H6v18h12V7l-4-4ZM14 3v5h4M9 12h6M9 16h6' /></svg>原文<span className='summary-option-stats ml-auto text-xs'>({tokenLabel('original')})</span></button>
      {(['summary', 'compact'] as const).map(value => {
        const busy = !!job?.busy && (job.format === 'compact' ? 'compact' : 'summary') === value;
        const label = value === 'compact' ? '圧縮' : '要約';
        return <button key={value} type='button' aria-label={label} aria-busy={busy} className={buttonClass(tab === value)} aria-pressed={tab === value} onClick={event => {
          event.stopPropagation();
          if (menuRef.current) menuRef.current.open = false;
          if (job?.busy) return;
          const saved = range && (value === 'compact' ? compact : readable);
          const regenerate = !!saved && tab === value && !!event.currentTarget.closest('details');
          if (saved && !regenerate) { changeTab(value); return; }
          if (regenerate && !window.confirm(`表示中の${label}を再処理しますか？`)) return;
          if (!chat || !effectiveChat || !nodeId || !isSummaryEligible(chat.messages[messageIndex]) || effectiveChat.omittedNodes?.[nodeId] || generating.includes(nodeId)) return;
          const state = useStore.getState();
          void startBubbleSummary(effectiveChat, regenerate && range ? Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index) : [messageIndex], regenerate && saved ? saved.mode : 'single', regenerate && saved ? saved.sources[saved.sources.length - 1].nodeId : nodeId, { favoriteModels: state.favoriteModels, providers: state.providers, fallbackProvider: { endpoint: state.apiEndpoint, key: state.apiKey }, apiVersion: state.apiVersion, summaryConfig: state.bubbleSummaryConfig, summaryFormat: value === 'compact' ? 'compact' : undefined, t });
        }}><svg aria-hidden='true' className='summary-option-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d={value === 'compact' ? 'M3 6l4 6-4 6M21 6l-4 6 4 6M7 12h10M10 7h4M10 17h4' : 'M5 6h14M5 12h14M5 18h8'} /></svg><span className='relative inline-block'><span className={busy ? 'summary-busy-label' : ''}>{label}</span>{busy && <span role='status' className='summary-inline-progress absolute left-1/2 top-full -mt-1 -translate-x-1/2 text-[8px] leading-[6px]'><SyncDots label={`${label}生成中`} /></span>}</span><span className='summary-option-stats ml-auto text-xs'>({tokenLabel(value)})</span></button>;
      })}

    <button type='button' aria-label='要約・圧縮の詳細設定' className={buttonClass(false)} onClick={event => { event.stopPropagation(); setDialogFormat(tab === 'compact' ? 'compact' : undefined); setOpen(true); if (menuRef.current) menuRef.current.open = false; }}><span className='flex items-center justify-center gap-1'><SettingIcon className='h-3 w-3' /><span className='summary-details-label'>詳細設定</span></span></button>
    {job?.error && <button type='button' className='px-1 text-xs text-gray-500 dark:text-gray-400' title={job.error} onClick={event => { event.stopPropagation(); setOpen(true); }}>要約失敗</button>}
    </div>
  );
  return <>
    <details ref={menuRef} className='summary-format-dropdown relative shrink-0' onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape' && menuRef.current) menuRef.current.open = false; }}>
      <summary aria-label='表示形式' className='flex h-[26px] cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-xs text-gray-600 shadow-sm ring-1 ring-black/5 dark:bg-gray-800/80 dark:text-gray-300 dark:ring-white/10 [&::-webkit-details-marker]:hidden'>
        <span>{job?.busy ? job.format === 'compact' ? '圧縮' : '要約' : tab === 'compact' ? '圧縮' : tab === 'summary' ? '要約' : '原文'}</span>
        <span className='flex h-3 w-3 shrink-0 items-center justify-center'>{job?.busy ? <span role='status' className='text-[8px]'><SyncDots label={job.format === 'compact' ? '圧縮生成中' : '要約生成中'} /></span> : <DownChevronArrow />}</span>
      </summary>
      {controls}

    </details>
    <div className='summary-format-inline'><span className='mr-2 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400' title='送信内容の推定トークン数・原文からの節約率'>{tokenLabel(tab === 'compact' ? 'compact' : tab === 'summary' ? 'summary' : 'original')}</span>{controls}</div>
    {open && <SummaryDialog messageIndex={summary ? chat?.branchTree?.activePath.indexOf(summary.sources[summary.sources.length - 1]?.nodeId) ?? -1 : messageIndex} initialSummary={summary} initialFormat={dialogFormat} setOpen={setOpen} />}
  </>;
}

function SummaryDialog({ messageIndex, initialSummary, initialFormat, setOpen }: { messageIndex: number; initialSummary?: BubbleSummary; initialFormat?: 'compact'; setOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const { t } = useTranslation();
  const initialChat = useRef(useStore.getState().chats?.[useStore.getState().currentChatIndex]).current;
  const chat = useStore(state => state.chats?.find(value => value.id === initialChat?.id));
  const omittedMaps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const endpoint = initialChat?.branchTree?.activePath[messageIndex];
  const job = useBubbleSummaryJob(initialChat?.id, endpoint);
  const [mode, setMode] = useState<BubbleSummary['mode']>(job ? job.mode : initialSummary?.mode ?? 'single');
  const [selected, setSelected] = useState<string[]>(() => job ? job.sourceNodeIds : initialSummary ? initialSummary.sources.map(source => source.nodeId) : endpoint ? [endpoint] : []);
  const summaryConfig = useStore(state => state.bubbleSummaryConfig);
  const [format, setFormat] = useState<'compact' | undefined>(job ? job.format : initialFormat);
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
  const generationConfig = summaryConfig ?? chat.config;
  const local = isLocalModelConfig(generationConfig);
  const reason = local ? 'ローカルモデルでは要約生成を利用できません。' : !generationConfig.model ? '要約のモデルを選択してください。' : !selected.length ? '要約するバブルを選択してください。' : !valid ? '同じ経路の連続した通常テキストを選択してください。不可視・画像・ツール・生成中のバブルは対象外です。' : '';
  const generate = () => {
    if (busy || reason) return;
    const state = useStore.getState();
    void startBubbleSummary(effectiveChat, indices, mode, endpoint!, { favoriteModels: state.favoriteModels, providers: state.providers, fallbackProvider: { endpoint: state.apiEndpoint, key: state.apiKey }, apiVersion: state.apiVersion, summaryConfig: state.bubbleSummaryConfig, summaryFormat: format, t });
    if (useSummaryGeneration.getState().jobs[`${chat.id}:${endpoint}`]?.busy) setOpen(false);
  };

  return <PopupModal title='要約・圧縮' setIsModalOpen={setOpen} handleClose={close} handleClickBackdrop={close} cancelButton={false}
    footerEndContent={<><button type='button' className='btn btn-neutral' onClick={close}>{busy ? '閉じる' : 'キャンセル'}</button><button type='button' className={`btn ${busy || reason ? 'btn-neutral cursor-not-allowed opacity-50' : 'btn-primary'}`} disabled={busy || !!reason} onClick={() => void generate()}>{busy ? '生成中…' : '要約を生成'}</button></>}>
    <div className='min-w-[18rem] space-y-3 p-5 text-sm text-gray-900 dark:text-gray-300'>
      <div role='radiogroup' aria-label='処理対象' className='flex flex-wrap items-center gap-x-3 gap-y-2'><span className='whitespace-nowrap'>処理対象:</span>{(['single', 'through', 'range'] as const).map(value => <label key={value} className='flex cursor-pointer items-center gap-1 text-gray-600 dark:text-gray-400'><input type='radio' className='accent-blue-600' name='summary-mode' checked={mode === value} disabled={busy} onChange={() => chooseMode(value)} />{value === 'single' ? 'このバブル' : value === 'through' ? 'ここまで' : '選択範囲'}</label>)}<ResetButton disabled={busy} visible={mode !== 'single' || selected.length !== 1 || selected[0] !== endpoint} onClick={() => chooseMode('single')} /></div>
      <div role='radiogroup' aria-label='要約の形式' className='flex flex-wrap items-center gap-x-3 gap-y-2'><span className='whitespace-nowrap'>要約の形式:</span>{(['readable', 'compact'] as const).map(value => <label key={value} className='flex items-center gap-1 whitespace-nowrap'><input type='radio' name='summary-format' className='accent-blue-600' checked={(format ?? 'readable') === value} disabled={busy} onChange={() => setFormat(value === 'compact' ? 'compact' : undefined)} />{value === 'readable' ? '読みやすい要約' : 'AI投入用の圧縮'}</label>)}<InfoTooltip text={<>原文は保持されます。読みやすい要約は生成後に表示・送信します。未生成の「要約」「圧縮」はそのバブルのみをすぐに生成します。歯車から対象範囲を設定できます。「原文」で原文の表示・送信に戻せます。先頭のシステム指示は要約しません。{format === 'compact' && <><br /><br />文体・ニュアンスの保持を試みます。原文と異なる内容や後続応答になる場合があります。生成後は圧縮文を表示・送信に使用します。内容を確認してください。原文は「原文」で確認できます。短い入力ではトークンが増える場合があります。</>}</>} /><ResetButton disabled={busy} visible={format === 'compact'} onClick={() => setFormat(undefined)} /></div>
      {initialSummary?.generation && <p className='break-all text-xs text-gray-500 dark:text-gray-400'>表示中の要約を生成した設定: {initialSummary.generation.model} · {initialSummary.generation.providerId ?? '既定のAPI'} · 温度 {initialSummary.generation.settings.temperature} · 出力上限 {initialSummary.generation.settings.max_tokens || 'モデル既定'} · 思考 {initialSummary.generation.settings.reasoning_effort ?? 'モデル既定'}</p>}
      <SummarySettingsFields config={chat.config} disabled={busy} />
      <div className='flex items-center justify-end gap-1 text-xs text-gray-500 dark:text-gray-400'><span>すべてリセット</span><ResetButton disabled={busy} onClick={() => { chooseMode('single'); setFormat(undefined); useStore.getState().setBubbleSummaryConfig(undefined); }} /></div>
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
