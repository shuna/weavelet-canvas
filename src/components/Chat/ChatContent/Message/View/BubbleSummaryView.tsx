import { useEffect, useState, type ReactNode } from 'react';
import useStore from '@store/store';
import { getAppliedBubbleSummaries, isBubbleSummary, resolveValidSummary } from '@utils/bubbleSummary';
import countTokens from '@utils/messageUtils';
import type { MessageInterface } from '@type/chat';
import BubbleSummaryControls from './BubbleSummaryControls';

import { useSummaryDisplay } from './bubbleSummaryDisplay';

export default function BubbleSummaryView({ nodeId, children }: { nodeId?: string; children: ReactNode }) {
  const currentChatIndex = useStore(state => state.currentChatIndex);
  const chat = useStore(state => state.chats?.[state.currentChatIndex]);
  const maps = useStore(state => state.omittedNodeMaps);
  const sessions = useStore(state => state.generatingSessions);
  const select = useSummaryDisplay(state => state.select);
  const tabs = useSummaryDisplay(state => state.tabs);
  const chosen = useSummaryDisplay(state => state.chosen);
  const choose = useSummaryDisplay(state => state.choose);
  const summaries = Array.isArray(chat?.summaries) ? (chat?.summaries ?? []).filter(isBubbleSummary) : [];
  const candidates = summaries.filter(summary => summary.sources.some(source => source.nodeId === nodeId));
  const summary = candidates.find(value => value.id === chosen[`${chat?.id}:${nodeId}`]) ?? candidates[candidates.length - 1];
  const effectiveChat = chat ? { ...chat, omittedNodes: maps[String(currentChatIndex)] ?? chat.omittedNodes } : undefined;
  const generating = Object.values(sessions).filter(session => session.chatId === chat?.id).map(session => session.targetNodeId);
  const range = effectiveChat && summary ? resolveValidSummary(effectiveChat, summary, generating) : null;
  const applied = effectiveChat ? getAppliedBubbleSummaries(effectiveChat, chat?.messages.length, generating) : [];
  const sendingSummary = applied.some(value => value.summary.id === summary?.id);
  const overlapping = !!summary?.useForSubmit && !!range && !sendingSummary;
  const activeOther = !sendingSummary && !!summary && applied.some(value => value.summary.sources.some(source => summary.sources.some(other => other.nodeId === source.nodeId)));
  const key = summary && chat ? `${chat.id}:${summary.id}` : '';
  const tab = range ? tabs[key] ?? 'original' : 'original';
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
  const changeTab = (value: 'original' | 'summary') => { choose(chat.id, summary); select(key, value); };
  if (!anchor) return <>
    <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-violet-700 dark:text-violet-300'>
      <span>要約範囲に含まれます（{summary.sources.length}件）</span>
      <button type='button' className='underline disabled:opacity-50' disabled={!range} onClick={() => changeTab(tab === 'original' ? 'summary' : 'original')}>{tab === 'original' ? '要約を表示' : '原文を表示'}</button>
      {!range && <span>要約の更新が必要です。原文を表示します。</span>}
      <span>{sendingSummary ? '送信：要約' : activeOther ? '送信：別の要約' : '送信：原文'}</span>
    </div>
    <div hidden={tab !== 'original'}>{children}</div>
  </>;
  const panelId = `summary-panel-${summary.id}`;
  return <section className='rounded-2xl border border-violet-200 p-3 dark:border-violet-700' onClick={event => event.stopPropagation()}>
    <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
      <div role='tablist' aria-label='原文と要約の表示' className='flex rounded-full bg-gray-100 p-1 dark:bg-gray-800'>
        {(['original', 'summary'] as const).map(value => <button key={value} id={`${panelId}-${value}`} type='button' role='tab' disabled={value === 'summary' && !range} aria-selected={tab === value} aria-controls={panelId} tabIndex={tab === value ? 0 : -1}
          className={`rounded-full px-4 py-1.5 text-sm ${tab === value ? 'bg-white shadow-sm dark:bg-gray-600' : 'text-gray-500'}`}
          onClick={() => changeTab(value)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'original' : event.key === 'End' ? 'summary' : value === 'original' ? 'summary' : 'original';
            changeTab(next); document.getElementById(`${panelId}-${next}`)?.focus();
          }}>{value === 'original' ? '原文' : '要約'}</button>)}
      </div>
      <span className='text-xs text-gray-500'>対象 {summary.sources.length}件</span>
      {candidates.length > 1 && <label className='text-xs'>保存済み要約 <select aria-label='保存済み要約' className='rounded border bg-transparent p-1' value={summary.id} onChange={event => { const value = candidates.find(item => item.id === event.target.value); if (value) choose(chat.id, value); }}>{candidates.map(value => <option key={value.id} value={value.id}>{value.sources.length}件 · {value.text.slice(0, 32)}</option>)}</select></label>}
    </div>
    <div role='tabpanel' id={panelId} aria-labelledby={`${panelId}-${tab}`}>
      <div hidden={tab !== 'original'}>{children}</div>
      <div hidden={tab !== 'summary'} className='whitespace-pre-wrap break-words rounded-xl bg-violet-50 p-4 dark:bg-violet-950/30'>{summary.text}</div>
    </div>
    <div className='mt-3 flex flex-wrap items-center gap-2 border-t border-violet-100 pt-3 text-xs dark:border-violet-800'>
      <span>送信：</span>
      <button type='button' aria-pressed={!sendingSummary && !activeOther} className={`rounded-full px-3 py-1.5 ${!sendingSummary && !activeOther ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100' : 'bg-gray-100 dark:bg-gray-800'}`} onClick={() => changeSend(false)}>原文{!sendingSummary && !activeOther ? ' · 送信に使用' : ''}</button>
      <button type='button' aria-pressed={sendingSummary} disabled={!range || generating.length > 0} className={`rounded-full px-3 py-1.5 disabled:opacity-40 ${sendingSummary ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100' : 'bg-gray-100 dark:bg-gray-800'}`} onClick={() => changeSend(true)}>要約{sendingSummary ? ' · 送信に使用' : ''}</button>
      <BubbleSummaryControls messageIndex={chat.branchTree?.activePath.indexOf(nodeId) ?? -1} initialSummary={summary} />
    </div>
    <p className='mt-2 text-xs text-amber-700 dark:text-amber-300' aria-live='polite'>{!range ? '原文を送信します。要約の更新が必要です（原文・対象・不可視・生成状態を確認してください）。' : overlapping ? '重複する要約が指定されているため原文を送信します。利用する要約を選び直してください。' : activeOther ? '対象の一部は別の保存済み要約で送信されます。原文またはこの要約を選ぶと、重なる送信設定を解除します。' : saving !== null ? saving >= 0 ? `概算 ${saving}トークン削減／送信。要約生成分は別途使用します。` : `要約は原文より概算 ${-saving}トークン多くなります。` : '表示タブの切り替えでは送信設定は変わりません。'}</p>
  </section>;
}
