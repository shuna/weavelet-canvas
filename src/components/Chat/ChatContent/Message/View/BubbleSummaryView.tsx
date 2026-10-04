import { useEffect, useState, type ReactNode } from 'react';
import useStore from '@store/store';
import { getAppliedBubbleSummaries } from '@utils/bubbleSummary';
import countTokens from '@utils/messageUtils';
import type { MessageInterface } from '@type/chat';

import { useBubbleSummary, useSummaryDisplay } from './bubbleSummaryDisplay';

export default function BubbleSummaryView({ nodeId, children }: { nodeId?: string; children: ReactNode }) {
  const { chat, candidates, summary, effectiveChat, generating, range, tab } = useBubbleSummary(nodeId);
  const choose = useSummaryDisplay(state => state.choose);
  const applied = effectiveChat ? getAppliedBubbleSummaries(effectiveChat, chat?.messages.length, generating) : [];
  const sendingSummary = applied.some(value => value.summary.id === summary?.id);
  const overlapping = !!summary?.useForSubmit && !!range && !sendingSummary;
  const activeOther = !sendingSummary && !!summary && applied.some(value => value.summary.sources.some(source => summary.sources.some(other => other.nodeId === source.nodeId)));
  const anchor = summary?.sources[summary.sources.length - 1]?.nodeId === nodeId;
  const [saving, setSaving] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSaving(null);
    if (summary && range && chat) {
      const originals = chat.messages.slice(range.first, range.last + 1);
      const replacement: MessageInterface[] = [{ role: 'user', content: [{ type: 'text', text: `Past conversation summary:\n${summary.text}` }] }];
      void Promise.all([countTokens(originals, chat.config.model), countTokens(replacement, chat.config.model)]).then(([before, after]) => { if (!cancelled) setSaving(before - after); }).catch(() => { if (!cancelled) setSaving(null); });
    }
    return () => { cancelled = true; };
  }, [summary, range?.first, range?.last, chat?.config.model]);
  if (!summary || !chat || !nodeId) return <>{children}</>;
  const changeSend = (use: boolean) => useStore.getState().setSummaryForSubmit(chat.id, summary.id, use);
  if (!anchor) return <>
    <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
      <span>要約範囲に含まれます（{summary.sources.length}件）</span>
      {!range && <span>要約の更新が必要です。原文を表示します。</span>}
      <span>{sendingSummary ? '送信：要約' : activeOther ? '送信：別の要約' : '送信：原文'}</span>
    </div>
    <div hidden={tab !== 'original'}>{children}</div>
  </>;
  return <section className='rounded-2xl border border-black/10 p-3 text-gray-800 dark:border-white/10 dark:text-gray-100' onClick={event => event.stopPropagation()}>
    {candidates.length > 1 && <label className='mb-3 block text-xs'>保存済み要約 <select aria-label='保存済み要約' className='rounded border bg-transparent p-1' value={summary.id} onChange={event => { const value = candidates.find(item => item.id === event.target.value); if (value) choose(chat.id, value); }}>{candidates.map(value => <option key={value.id} value={value.id}>{value.sources.length}件 · {value.text.slice(0, 32)}</option>)}</select></label>}
    <div>
      <div hidden={tab !== 'original'}>{children}</div>
      <div hidden={tab !== 'summary'} className='whitespace-pre-wrap break-words rounded-2xl bg-white/60 p-4 text-gray-800 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:text-gray-100 dark:ring-white/10'>{summary.text}</div>
    </div>
    <div className='mt-3 flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 text-xs dark:border-white/10'>
      <span>送信：</span>
      <button type='button' aria-pressed={!sendingSummary && !activeOther} className={`rounded-full px-3 py-1.5 ${!sendingSummary && !activeOther ? 'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100' : 'bg-gray-100 dark:bg-gray-800'}`} onClick={() => changeSend(false)}>原文{!sendingSummary && !activeOther ? ' · 送信に使用' : ''}</button>
      <button type='button' aria-pressed={sendingSummary} disabled={!range || generating.length > 0} className={`rounded-full px-3 py-1.5 disabled:opacity-40 ${sendingSummary ? 'bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100' : 'bg-gray-100 dark:bg-gray-800'}`} onClick={() => changeSend(true)}>要約{sendingSummary ? ' · 送信に使用' : ''}</button>
    </div>
    <p className='mt-2 text-xs text-gray-500 dark:text-gray-400' aria-live='polite'>{!range ? '原文を送信します。要約の更新が必要です（原文・対象・不可視・生成状態を確認してください）。' : overlapping ? '重複する要約が指定されているため原文を送信します。利用する要約を選び直してください。' : activeOther ? '対象の一部は別の保存済み要約で送信されます。原文またはこの要約を選ぶと、重なる送信設定を解除します。' : saving !== null ? saving >= 0 ? `概算 ${saving}トークン削減／送信。要約生成分は別途使用します。` : `要約は原文より概算 ${-saving}トークン多くなります。` : '表示の切り替えでは送信設定は変わりません。'}</p>
  </section>;
}
