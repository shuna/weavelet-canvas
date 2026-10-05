import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import useStore from '@store/store';
import { countTokens, loadEncoder } from '@utils/messageUtils';
import OverTypeEditor from './OverTypeEditor';
import type { BubbleSummary } from '@type/chat';
import { bubbleSummarySubmitMessage, normalizeBubbleSummaryText } from '@utils/bubbleSummary';

import { useBubbleSummary, useSummaryDisplay } from './bubbleSummaryDisplay';

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

export default function BubbleSummaryView({ nodeId, isCollapsed = false, children }: { nodeId?: string; isCollapsed?: boolean; children: ReactNode }) {
  const { chat, candidates, summary, range, tab } = useBubbleSummary(nodeId);
  const markdownMode = useStore(state => state.markdownMode);
  const inlineLatex = useStore(state => state.inlineLatex);
  const choose = useSummaryDisplay(state => state.choose);
  const anchor = summary?.sources[summary.sources.length - 1]?.nodeId === nodeId;
  const [tokens, setTokens] = useState<{ original: number; compact: number }>();
  useEffect(() => {
    let current = true;
    setTokens(undefined);
    if (anchor && summary?.format === 'compact' && chat && range) {
      loadEncoder().then(() => Promise.all([countTokens(chat.messages.slice(range.first, range.last + 1), chat.config.model), countTokens([bubbleSummarySubmitMessage(summary)], chat.config.model)]))
        .then(([original, compact]) => { if (current) setTokens({ original, compact }); }).catch(() => {});
    }
    return () => { current = false; };
  }, [anchor, chat, summary, range?.first, range?.last]);
  if (!summary || !chat || !nodeId) return <>{children}</>;
  if (!anchor) return <>
    <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
      <span>要約範囲に含まれます（{summary.sources.length}件）</span>
      {!range && <span>要約の更新が必要です。原文を表示します。</span>}
    </div>
    <div hidden={tab !== 'original'}>{children}</div>
  </>;
  const versions = candidates.filter(value => value.format === summary.format);
  return <section className='text-gray-800 dark:text-gray-100' onClick={event => event.stopPropagation()}>
    {versions.length > 1 && <label className='mb-3 block text-xs'>保存済み要約 <select aria-label='保存済み要約' className='rounded border bg-transparent p-1' value={summary.id} onChange={event => { const value = candidates.find(item => item.id === event.target.value); if (value) choose(chat.id, value, tab !== 'original'); }}>{versions.map(value => <option key={value.id} value={value.id}>{value.sources.length}件 · {normalizeBubbleSummaryText(value.text).slice(0, 32)}</option>)}</select></label>}
    <div>
      <div hidden={tab !== 'original'}>{children}</div>
      <div hidden={tab === 'original'}>
        <SummaryText key={`${summary.id}:${tab}`} chatId={chat.id} summary={summary} isCollapsed={isCollapsed} markdownMode={markdownMode} inlineLatex={inlineLatex} />
        {summary.format === 'compact' && <div className='mt-2 text-xs text-gray-500 dark:text-gray-400'>{tokens && <p>送信トークンの推定（{chat.config.model}）: 原文 {tokens.original} → 圧縮 {tokens.compact} · {tokens.original > tokens.compact ? `${tokens.original - tokens.compact}削減` : '削減なし'}。APIの実測値とは異なる場合があります。</p>}<p>圧縮は実験機能です。原文と異なる後続応答になる場合があります。生成時のモデル: {summary.generation?.model ?? '記録なし'}</p></div>}
      </div>
    </div>
    {(!range || (summary.useForSubmit && tab === 'original')) && <p className='mt-2 text-xs text-gray-500 dark:text-gray-400' aria-live='polite'>{!range ? '原文を表示・送信します。要約の更新が必要です（原文・対象・不可視・生成状態を確認してください）。' : '要約の対象が重複しているため原文を表示・送信します。要約を選び直してください。'}</p>}
  </section>;
}

// Both generated formats share the same display and editor; saving never changes source bubbles.
function SummaryText({ chatId, summary, isCollapsed, markdownMode, inlineLatex }: { chatId: string; summary: BubbleSummary; isCollapsed: boolean; markdownMode: boolean; inlineLatex: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const text = normalizeBubbleSummaryText(summary.text);
  const preview = text.replace(/\s+/g, ' ').trim();
  const name = summary.format === 'compact' ? '圧縮' : '要約';
  const save = () => {
    const state = useStore.getState();
    const current = state.chats?.find(chat => chat.id === chatId)?.summaries?.find(value => value.id === summary.id);
    if (!current || !draft.trim()) return;
    state.saveBubbleSummary(chatId, { ...current, text: draft });
    setEditing(false);
  };
  return <div data-summary-content className={`break-words rounded-2xl bg-white/60 text-gray-800 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:text-gray-100 dark:ring-white/10 ${isCollapsed && !editing ? 'px-4 pt-2.5 pb-2 md:px-5 md:pt-3 md:pb-2.5' : 'p-4'}`}>
    {editing ? <>
      <OverTypeEditor value={draft} mode='edit' onChange={setDraft} placeholder={`${name}を編集`} autoFocus autoResize minHeight='5.25rem' />
      <div className='mt-2 flex gap-2'><button type='button' className='btn btn-neutral' onClick={() => setEditing(false)}>キャンセル</button><button type='button' className='btn btn-primary' disabled={!draft.trim()} onClick={save}>{name}を保存</button></div>
    </> : <>
      {isCollapsed ? <div data-summary-preview className='h-[4.5rem] overflow-hidden py-0 text-sm leading-6 text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words line-clamp-3'>{preview.length > 280 ? `${preview.slice(0, 280)}...` : preview}</div> : <div className='markdown prose w-full max-w-full break-words dark:prose-invert'>
        {markdownMode ? <Suspense fallback={<span className='whitespace-pre-wrap'>{text}</span>}><MarkdownRenderer content={text} inlineLatex={inlineLatex} /></Suspense> : <span className='whitespace-pre-wrap'>{text}</span>}
      </div>}
      <div className='mt-2 flex gap-2 text-xs'><button type='button' onClick={() => { setDraft(text); setEditing(true); }}>{name}を編集</button><button type='button' onClick={() => navigator.clipboard.writeText(text)}>{name}をコピー</button></div>
    </>}
  </div>;
}
