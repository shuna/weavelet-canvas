import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import useStore from '@store/store';
import { countTokens, loadEncoder } from '@utils/messageUtils';
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
    <div hidden={summary.format !== 'compact' && tab !== 'original'}>{children}</div>
  </>;
  const text = normalizeBubbleSummaryText(summary.text);
  const previewText = text.replace(/\s+/g, ' ').trim();
  const collapsedPreview = previewText.length > 280 ? `${previewText.slice(0, 280)}...` : previewText;
  return <section className='text-gray-800 dark:text-gray-100' onClick={event => event.stopPropagation()}>
    {candidates.length > 1 && <label className='mb-3 block text-xs'>保存済み要約 <select aria-label='保存済み要約' className='rounded border bg-transparent p-1' value={summary.id} onChange={event => { const value = candidates.find(item => item.id === event.target.value); if (value) choose(chat.id, value, value.format === 'compact' ? false : tab === 'summary'); }}>{candidates.map(value => <option key={value.id} value={value.id}>{value.sources.length}件 · {normalizeBubbleSummaryText(value.text).slice(0, 32)}</option>)}</select></label>}
    <div>
      <div hidden={summary.format !== 'compact' && tab !== 'original'}>{children}</div>
      <div hidden={summary.format === 'compact' || tab !== 'summary'} data-summary-content className={`break-words rounded-2xl bg-white/60 text-gray-800 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:text-gray-100 dark:ring-white/10 ${isCollapsed ? 'px-4 pt-2.5 pb-2 md:px-5 md:pt-3 md:pb-2.5' : 'p-4'}`}>
        {isCollapsed ? <div data-summary-preview className='h-[4.5rem] overflow-hidden py-0 text-sm leading-6 text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words line-clamp-3'>{collapsedPreview}</div> : <div className='markdown prose w-full max-w-full break-words dark:prose-invert'>
          {markdownMode ? <Suspense fallback={<span className='whitespace-pre-wrap'>{text}</span>}><MarkdownRenderer content={text} inlineLatex={inlineLatex} /></Suspense> : <span className='whitespace-pre-wrap'>{text}</span>}
        </div>}
      </div>
    </div>
    {summary.format === 'compact' && <details className='mt-3 rounded border border-gray-300 p-3 text-sm dark:border-gray-600'><summary>AI投入用の圧縮 · {range && tab === 'summary' ? '送信に使用中' : '原文を送信'}</summary>{tokens && <p className='mt-2 text-xs'>送信トークンの推定（{chat.config.model}）: 原文 {tokens.original} → 圧縮 {tokens.compact} · {tokens.original > tokens.compact ? `${tokens.original - tokens.compact}削減` : '削減なし'}。APIの実測値とは異なる場合があります。</p>}<pre className='mt-2 whitespace-pre-wrap break-words font-sans'>{text}</pre><p className='mt-2 text-xs'>文体・意味の保持を確認してから使用してください。生成したモデル: {summary.generation?.model ?? '記録なし'}</p></details>}
    {(!range || (summary.useForSubmit && tab === 'original')) && <p className='mt-2 text-xs text-gray-500 dark:text-gray-400' aria-live='polite'>{!range ? '原文を表示・送信します。要約の更新が必要です（原文・対象・不可視・生成状態を確認してください）。' : '要約の対象が重複しているため原文を表示・送信します。要約を選び直してください。'}</p>}
  </section>;
}
