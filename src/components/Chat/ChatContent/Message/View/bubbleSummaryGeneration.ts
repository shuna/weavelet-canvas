import { create } from 'zustand';
import useStore from '@store/store';
import { generateBubbleSummary } from '@hooks/submitHelpers';
import countTokens from '@utils/messageUtils';
import { bubbleSummarySubmitMessage, resolveValidSummary } from '@utils/bubbleSummary';
import { isTextContent, type BubbleSummary, type ChatInterface } from '@type/chat';
import { useSummaryDisplay } from './bubbleSummaryDisplay';
import { pickModelSettings } from '@utils/modelSettings';
import { hardOpenRouterConstraints } from '@utils/openrouterControls';

type SummaryJob = { chatId: string; originNodeId: string; sourceNodeIds: string[]; mode: BubbleSummary['mode']; format?: 'compact'; busy: boolean; error: string; warning?: string };
export const useSummaryGeneration = create<{ jobs: Record<string, SummaryJob> }>(() => ({ jobs: {} }));
export const useBubbleSummaryJob = (chatId?: string, nodeId?: string) => useSummaryGeneration(state => {
  const matches = Object.values(state.jobs).filter(job => job.chatId === chatId && (job.originNodeId === nodeId || job.sourceNodeIds.includes(nodeId ?? '')));
  return matches.find(job => job.busy) ?? matches[matches.length - 1];
});

// A request belongs to the chat and source snapshot, not the lifetime of its confirmation dialog.
export async function startBubbleSummary(chat: ChatInterface, indices: number[], mode: BubbleSummary['mode'], originNodeId: string, deps: Parameters<typeof generateBubbleSummary>[2]) {
  const path = chat.branchTree!.activePath;
  const sources = indices.map(index => ({ nodeId: path[index], parentId: chat.branchTree!.nodes[path[index]].parentId, role: chat.messages[index].role as 'user' | 'assistant', textParts: chat.messages[index].content.filter(isTextContent).map(value => value.text) }));
  if (Object.values(useSummaryGeneration.getState().jobs).some(job => job.busy && job.chatId === chat.id && (job.originNodeId === originNodeId || job.sourceNodeIds.some(id => sources.some(source => source.nodeId === id))))) return false;
  const previous = chat.summaries?.find(summary => summary.mode === mode && summary.format === deps.summaryFormat && summary.sources.length === sources.length && summary.sources.every((source, index) => source.nodeId === sources[index].nodeId));
  const summary: BubbleSummary = { id: previous?.id ?? crypto.randomUUID(), mode, format: deps.summaryFormat, sources, text: '', useForSubmit: false };
  const key = `${chat.id}:${originNodeId}`;
  const job: SummaryJob = { chatId: chat.id, originNodeId, sourceNodeIds: sources.map(source => source.nodeId), mode, format: deps.summaryFormat, busy: true, error: '' };
  useSummaryGeneration.setState(state => ({ jobs: { ...Object.fromEntries(Object.entries(state.jobs).filter(([, previousJob]) => previousJob.busy || previousJob.chatId !== chat.id || !previousJob.sourceNodeIds.some(id => job.sourceNodeIds.includes(id)))), [key]: job } }));
  let error = '';
  let warning = '';
  try {
    const config = deps.summaryConfig ?? chat.config;
    summary.generation = { model: config.model, providerId: config.providerId, createdAt: Date.now(), settings: { ...pickModelSettings(config), stream: false, openRouter: { routing: hardOpenRouterConstraints(config.openRouter), responseCache: { mode: 'off' } } } };
    const text = await generateBubbleSummary(chat, indices, deps);
    const latest = useStore.getState();
    const index = latest.chats?.findIndex(value => value.id === chat.id) ?? -1;
    const value = latest.chats?.[index];
    if (!value) return false;
    const generating = Object.values(latest.generatingSessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId);
    if (!resolveValidSummary({ ...value, omittedNodes: latest.omittedNodeMaps[String(index)] ?? value.omittedNodes }, { ...summary, text }, generating)) throw new Error('対象の原文や状態が変わりました。対象を確認して生成し直してください。');
    const saved = { ...summary, text };
    const [originalTokens, replacementTokens] = await Promise.all([
      countTokens(indices.map(index => value.messages[index]), value.config.model),
      countTokens([bubbleSummarySubmitMessage(saved)], value.config.model),
    ]);
    const currentState = useStore.getState();
    const currentIndex = currentState.chats?.findIndex(item => item.id === chat.id) ?? -1;
    const currentChat = currentState.chats?.[currentIndex];
    if (!currentChat) return false;
    if (currentChat.config.model !== value.config.model || !resolveValidSummary({ ...currentChat, omittedNodes: currentState.omittedNodeMaps[String(currentIndex)] ?? currentChat.omittedNodes }, saved, Object.values(currentState.generatingSessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId))) throw new Error('対象の原文や設定が変わりました。対象を確認して生成し直してください。');
    const savesTokens = replacementTokens < originalTokens;
    if (!savesTokens) warning = `送信内容の推定トークン数を削減できませんでした（原文 ${originalTokens} → ${replacementTokens} tokens）。生成文は保存しましたが、原文を表示・送信します。必要なら要約・圧縮を明示的に選択できます。`;
    latest.saveBubbleSummary(chat.id, saved);
    useSummaryDisplay.getState().choose(chat.id, saved, savesTokens);
    return true;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : '要約を生成できませんでした。';
    return false;
  } finally {
    useSummaryGeneration.setState(state => {
      const jobs = { ...state.jobs };
      if (error || warning) jobs[key] = { ...job, busy: false, error, warning };
      else delete jobs[key];
      return { jobs };
    });
  }
}
