import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PopupModal from '@components/PopupModal';
import useStore from '@store/store';
import { generateBubbleSummary, isLocalModelConfig } from '@hooks/submitHelpers';
import { isSummaryEligible, resolveValidSummary } from '@utils/bubbleSummary';
import { BubbleSummary, isTextContent } from '@type/chat';
import { useSummaryDisplay } from './bubbleSummaryDisplay';

export default function BubbleSummaryControls({ messageIndex, initialSummary }: { messageIndex: number; initialSummary?: BubbleSummary }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type='button' className='rounded-full px-2 py-1 text-xs text-violet-600 dark:text-violet-300' onClick={event => { event.stopPropagation(); setOpen(true); }} aria-label='要約を作成'>要約を作成</button>
    {open && <SummaryDialog messageIndex={messageIndex} initialSummary={initialSummary} setOpen={setOpen} />}
  </>;
}

function SummaryDialog({ messageIndex, initialSummary, setOpen }: { messageIndex: number; initialSummary?: BubbleSummary; setOpen: React.Dispatch<React.SetStateAction<boolean>> }) {
  const { t } = useTranslation();
  const initialChat = useRef(useStore.getState().chats?.[useStore.getState().currentChatIndex]).current;
  const chat = useStore(state => state.chats?.find(value => value.id === initialChat?.id));
  const omittedMaps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const [mode, setMode] = useState<BubbleSummary['mode']>(initialSummary?.mode ?? 'single');
  const [selected, setSelected] = useState<string[]>(() => initialSummary ? initialSummary.sources.map(source => source.nodeId) : initialChat?.branchTree?.activePath[messageIndex] ? [initialChat.branchTree.activePath[messageIndex]] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => { controller.current?.abort(); setOpen(false); };
  if (!chat?.branchTree) return null;
  const path = chat.branchTree.activePath;
  const endpoint = initialChat?.branchTree?.activePath[messageIndex];
  const endIndex = endpoint ? path.indexOf(endpoint) : -1;
  const currentIndex = useStore.getState().chats?.findIndex(value => value.id === chat.id) ?? -1;
  const effectiveChat = { ...chat, omittedNodes: omittedMaps[String(currentIndex)] ?? chat.omittedNodes };
  const generating = Object.values(sessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId);
  const candidate = (index: number) => mode === 'range' || (mode === 'single' ? path[index] === endpoint : index <= endIndex);
  const eligible = (index: number) => isSummaryEligible(chat.messages[index]) && !effectiveChat.omittedNodes?.[path[index]] && !generating.includes(path[index]);
  const chooseMode = (next: BubbleSummary['mode']) => {
    setMode(next); setError('');
    setSelected(next === 'single' ? endpoint ? [endpoint] : [] : next === 'through'
      ? path.slice(0, endIndex + 1).filter((_, index) => chat.messages[index]?.role !== 'system')
      : path.filter(id => chat.summaryTargets?.[id]));
  };
  const indices = path.map((id, index) => selected.includes(id) ? index : -1).filter(index => index >= 0);
  const continuous = indices.length > 0 && indices.length === selected.length && indices[indices.length - 1] - indices[0] + 1 === indices.length;
  const valid = continuous && indices.every(index => eligible(index) && candidate(index)) && (mode !== 'single' || indices.length === 1);
  const local = isLocalModelConfig(chat.config);
  const reason = local ? 'ローカルモデルでは要約生成を利用できません。' : !chat.config.model ? 'チャットのモデルを選択してください。' : !valid ? '同じ経路の連続した通常テキストを選択してください。不可視・画像・ツール・生成中のバブルは対象外です。' : '';
  const generate = async () => {
    if (busy || reason) return;
    const state = useStore.getState();
    const sources = indices.map(index => ({ nodeId: path[index], parentId: chat.branchTree!.nodes[path[index]].parentId, role: chat.messages[index].role as 'user' | 'assistant', textParts: chat.messages[index].content.filter(isTextContent).map(value => value.text) }));
    const previous = chat.summaries?.find(summary => summary.mode === mode && summary.sources.length === sources.length && summary.sources.every((source, index) => source.nodeId === sources[index].nodeId));
    const summary: BubbleSummary = { id: previous?.id ?? crypto.randomUUID(), mode, sources, text: '', useForSubmit: false };
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const text = await generateBubbleSummary(effectiveChat, indices, { favoriteModels: state.favoriteModels, providers: state.providers, fallbackProvider: { endpoint: state.apiEndpoint, key: state.apiKey }, apiVersion: state.apiVersion, t }, abort.signal);
      if (abort.signal.aborted) return;
      const latest = useStore.getState();
      const index = latest.chats?.findIndex(value => value.id === chat.id) ?? -1;
      const value = latest.chats?.[index];
      const currentGenerating = Object.values(latest.generatingSessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId);
      if (!value || !resolveValidSummary({ ...value, omittedNodes: latest.omittedNodeMaps[String(index)] ?? value.omittedNodes }, { ...summary, text }, currentGenerating)) {
        setError('対象の原文や状態が変わりました。対象を確認して生成し直してください。'); return;
      }
      const saved = { ...summary, text };
      latest.saveBubbleSummary(chat.id, saved);
      useSummaryDisplay.getState().choose(chat.id, saved);
      useSummaryDisplay.getState().select(`${chat.id}:${summary.id}`, 'summary');
      setOpen(false);
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '要約を生成できませんでした。');
    } finally { if (!abort.signal.aborted) setBusy(false); }
  };
  return <PopupModal title='要約の対象を選択' setIsModalOpen={setOpen} handleClose={close} handleClickBackdrop={close} cancelButton={false}
    footerEndContent={<><button type='button' className='btn btn-neutral' onClick={close}>{busy ? '生成を中止' : 'キャンセル'}</button><button type='button' className='btn btn-primary' disabled={busy || !!reason} onClick={() => void generate()}>{busy ? '生成中…' : '要約を生成'}</button></>}>
    <div className='min-w-[18rem] space-y-3 p-5 text-sm'>
      <div className='flex flex-wrap gap-3'>{(['single', 'through', 'range'] as const).map(value => <label key={value} className='flex items-center gap-1'><input type='radio' name='summary-mode' checked={mode === value} disabled={busy} onChange={() => chooseMode(value)} />{value === 'single' ? 'このバブル' : value === 'through' ? 'ここまで' : '選択範囲'}</label>)}</div>
      <p className='text-xs text-gray-500'>原文は保持されます。生成後は原文送信のまま、要約タブで結果を確認できます。先頭のシステム指示は要約しません。</p>
      <div className='max-h-72 space-y-2 overflow-y-auto'>{path.map((id, index) => <label key={id} className={`flex items-start gap-2 rounded border p-2 ${eligible(index) ? '' : 'opacity-50'}`}>
        <input type='checkbox' aria-label={`バブル${index + 1}を要約に含める`} checked={selected.includes(id)} disabled={busy || !candidate(index) || (!eligible(index) && !selected.includes(id))} onChange={() => {
          setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
          if (mode === 'range') {
            const current = useStore.getState(); const targetIndex = current.chats?.findIndex(value => value.id === chat.id) ?? -1;
            if (!!current.chats?.[targetIndex]?.summaryTargets?.[id] !== !selected.includes(id)) current.toggleSummaryTarget(targetIndex, index);
          }
        }} />
        <span><strong>{index + 1}. {chat.messages[index]?.role === 'user' ? 'ユーザー' : chat.messages[index]?.role === 'assistant' ? 'アシスタント' : 'システム'}</strong><span className='block whitespace-pre-wrap break-words text-xs'>{chat.messages[index]?.content.filter(isTextContent).map(value => value.text).join('\n').slice(0, 240)}</span></span>
      </label>)}</div>
      <p aria-live='polite' className='text-xs text-amber-700 dark:text-amber-300'>{error || reason || `対象 ${selected.length}件`}</p>
    </div>
  </PopupModal>;
}
