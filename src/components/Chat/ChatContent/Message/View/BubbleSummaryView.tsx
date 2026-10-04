import { lazy, Suspense, type ReactNode } from 'react';
import useStore from '@store/store';

import { useBubbleSummary, useSummaryDisplay } from './bubbleSummaryDisplay';

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'));

export default function BubbleSummaryView({ nodeId, children }: { nodeId?: string; children: ReactNode }) {
  const { chat, candidates, summary, range, tab } = useBubbleSummary(nodeId);
  const markdownMode = useStore(state => state.markdownMode);
  const inlineLatex = useStore(state => state.inlineLatex);
  const choose = useSummaryDisplay(state => state.choose);
  const anchor = summary?.sources[summary.sources.length - 1]?.nodeId === nodeId;
  if (!summary || !chat || !nodeId) return <>{children}</>;
  if (!anchor) return <>
    <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
      <span>要約範囲に含まれます（{summary.sources.length}件）</span>
      {!range && <span>要約の更新が必要です。原文を表示します。</span>}
    </div>
    <div hidden={tab !== 'original'}>{children}</div>
  </>;
  return <section className='rounded-2xl border border-black/10 p-3 text-gray-800 dark:border-white/10 dark:text-gray-100' onClick={event => event.stopPropagation()}>
    {candidates.length > 1 && <label className='mb-3 block text-xs'>保存済み要約 <select aria-label='保存済み要約' className='rounded border bg-transparent p-1' value={summary.id} onChange={event => { const value = candidates.find(item => item.id === event.target.value); if (value) choose(chat.id, value, tab === 'summary'); }}>{candidates.map(value => <option key={value.id} value={value.id}>{value.sources.length}件 · {value.text.slice(0, 32)}</option>)}</select></label>}
    <div>
      <div hidden={tab !== 'original'}>{children}</div>
      <div hidden={tab !== 'summary'} data-summary-content className='break-words rounded-2xl bg-white/60 p-4 text-gray-800 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:text-gray-100 dark:ring-white/10'>
        <div className='markdown prose w-full max-w-full break-words dark:prose-invert'>
          {markdownMode ? <Suspense fallback={<span className='whitespace-pre-wrap'>{summary.text}</span>}><MarkdownRenderer content={summary.text} inlineLatex={inlineLatex} /></Suspense> : <span className='whitespace-pre-wrap'>{summary.text}</span>}
        </div>
      </div>
    </div>
    {(!range || (summary.useForSubmit && tab === 'original')) && <p className='mt-2 text-xs text-gray-500 dark:text-gray-400' aria-live='polite'>{!range ? '原文を表示・送信します。要約の更新が必要です（原文・対象・不可視・生成状態を確認してください）。' : '要約の対象が重複しているため原文を表示・送信します。要約を選び直してください。'}</p>}
  </section>;
}
