import { type ReactNode } from 'react';
import type { BubbleSummary } from '@type/chat';
import { normalizeBubbleSummaryText } from '@utils/bubbleSummary';

import { useBubbleSummary, useSummaryDisplay } from './bubbleSummaryDisplay';

export default function BubbleSummaryView({ nodeId, isCollapsed = false, children, renderSummary }: { nodeId?: string; isCollapsed?: boolean; children: ReactNode; renderSummary: (summary: BubbleSummary) => ReactNode }) {
  const { chat, candidates, summary, range, tab } = useBubbleSummary(nodeId);
  const choose = useSummaryDisplay(state => state.choose);
  const anchor = summary?.sources[summary.sources.length - 1]?.nodeId === nodeId;
  if (!summary || !chat || !nodeId) return <>{children}</>;
  if (!anchor) return <>
    <div hidden={tab !== 'original'}>{children}</div>
  </>;
  const preview = normalizeBubbleSummaryText(summary.text).replace(/\s+/g, ' ').trim();
  const versions = candidates.filter(value => value.format === summary.format);
  return <section className='text-gray-800 dark:text-gray-100' onClick={event => event.stopPropagation()}>
    {versions.length > 1 && <label className='mb-3 block text-xs'>保存済み要約 <select aria-label='保存済み要約' className='rounded border bg-transparent p-1' value={summary.id} onChange={event => { const value = candidates.find(item => item.id === event.target.value); if (value) choose(chat.id, value, tab !== 'original'); }}>{versions.map(value => <option key={value.id} value={value.id}>{value.sources.length}件 · {normalizeBubbleSummaryText(value.text).slice(0, 32)}</option>)}</select></label>}
    <div>
      <div hidden={tab !== 'original'}>{children}</div>
      <div hidden={tab === 'original'}>
        {isCollapsed ? <div data-summary-content className='rounded-2xl bg-white/60 px-4 pt-2.5 pb-2 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:ring-white/10 md:px-5 md:pt-3 md:pb-2.5'><div data-summary-preview className='h-[4.5rem] overflow-hidden text-sm leading-6 whitespace-pre-wrap break-words line-clamp-3'>{preview.length > 280 ? `${preview.slice(0, 280)}...` : preview}</div></div> : <div data-summary-content key={`${summary.id}:${tab}`}>{tab !== 'original' && renderSummary(summary)}</div>}
      </div>
    </div>
    {(!range || (summary.useForSubmit && tab === 'original')) && <p className='mt-2 text-xs text-gray-500 dark:text-gray-400' aria-live='polite'>{!range ? '原文を表示・送信します。要約の更新が必要です（原文・対象・生成状態を確認してください）。' : '要約の対象が重複しているため原文を表示・送信します。要約を選び直してください。'}</p>}
  </section>;
}
