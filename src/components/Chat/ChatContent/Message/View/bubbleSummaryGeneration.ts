import { create } from 'zustand';
import useStore from '@store/store';
import { generateBubbleSummary } from '@hooks/submitHelpers';
import countTokens from '@utils/messageUtils';
import { bubbleSummarySubmitMessage } from '@utils/bubbleSummary';
import { type BubbleSummary, type ChatInterface } from '@type/chat';
import { useSummaryDisplay } from './bubbleSummaryDisplay';
import { evaluateBubbleSummary, overlapsBusySummary, selectBubbleSummary } from '@utils/bubbleSummaryOperations';

type SummaryJob = { chatId: string; originNodeId: string; sourceNodeIds: string[]; mode: BubbleSummary['mode']; format?: 'compact'; busy: boolean; error: string; warning?: string };
export const useSummaryGeneration = create<{ jobs: Record<string, SummaryJob> }>(() => ({ jobs: {} }));
export const useBubbleSummaryJob = (chatId?: string, nodeId?: string) => useSummaryGeneration(state => {
  const matches = Object.values(state.jobs).filter(job => job.chatId === chatId && (job.originNodeId === nodeId || job.sourceNodeIds.includes(nodeId ?? '')));
  return matches.find(job => job.busy) ?? matches[matches.length - 1];
});

// A request belongs to the chat and source snapshot, not the lifetime of its confirmation dialog.
export async function startBubbleSummary(chat: ChatInterface, indices: number[], mode: BubbleSummary['mode'], originNodeId: string, deps: Parameters<typeof generateBubbleSummary>[2]) {
  const path = chat.branchTree!.activePath;
  const sourceNodeIds = indices.map(index => path[index]);
  if (overlapsBusySummary(originNodeId, sourceNodeIds, Object.values(useSummaryGeneration.getState().jobs)
    .filter(job => job.busy && job.chatId === chat.id))) return false;
  const key = `${chat.id}:${originNodeId}`;
  const job: SummaryJob = { chatId: chat.id, originNodeId, sourceNodeIds, mode, format: deps.summaryFormat, busy: true, error: '' };
  useSummaryGeneration.setState(state => ({ jobs: { ...Object.fromEntries(Object.entries(state.jobs).filter(([, previousJob]) => previousJob.busy || previousJob.chatId !== chat.id || !previousJob.sourceNodeIds.some(id => job.sourceNodeIds.includes(id)))), [key]: job } }));
  let error = '';
  let warning = '';
  try {
    const selection = selectBubbleSummary(chat, sourceNodeIds, mode, originNodeId, deps.summaryFormat,
      deps.summaryConfig ?? chat.config, deps, crypto.randomUUID(), Date.now());
    const text = await generateBubbleSummary(chat, indices, deps);
    const latest = useStore.getState();
    const index = latest.chats?.findIndex(value => value.id === chat.id) ?? -1;
    const value = latest.chats?.[index];
    if (!value) return false;
    const generating = Object.values(latest.generatingSessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId);
    const initial = evaluateBubbleSummary({ ...value, omittedNodes: latest.omittedNodeMaps[String(index)] ?? value.omittedNodes }, selection, text, generating);
    const saved = initial.summary;
    const [originalTokens, replacementTokens] = await Promise.all([
      countTokens(indices.map(index => value.messages[index]), value.config.model),
      countTokens([bubbleSummarySubmitMessage(saved)], value.config.model),
    ]);
    const currentState = useStore.getState();
    const currentIndex = currentState.chats?.findIndex(item => item.id === chat.id) ?? -1;
    const currentChat = currentState.chats?.[currentIndex];
    if (!currentChat) return false;
    if (currentChat.config.model !== value.config.model) throw new Error('対象の原文や設定が変わりました。対象を確認して生成し直してください。');
    const result = evaluateBubbleSummary({ ...currentChat, omittedNodes: currentState.omittedNodeMaps[String(currentIndex)] ?? currentChat.omittedNodes }, selection,
      text, Object.values(currentState.generatingSessions).filter(session => session.chatId === chat.id).map(session => session.targetNodeId), originalTokens, replacementTokens);
    warning = result.warning ?? '';
    latest.saveBubbleSummary(chat.id, result.summary);
    useSummaryDisplay.getState().choose(chat.id, result.summary, result.savesTokens);
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
