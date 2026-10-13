import { generationRequest } from './generation';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { addTokenUsage, estimateTokensByChars } from '../../src/utils/chatTitle';
import { remoteModelContextInfo } from '../../src/utils/remoteModelLimits';
import { fitsContextWindow } from '../../src/utils/tokenBudget';
import { bubbleSummarySubmitMessage, normalizeBubbleSummaryText } from '../../src/utils/bubbleSummary';
import { describeBubbleSummary, evaluateBubbleSummary, removeBubbleSummary, selectBubbleSummary, setSummaryForSubmit, toggleSummaryTarget,
  type BusySummaryJob, type SummarySelection, type SummarySettings } from '../../src/utils/bubbleSummaryOperations';
import { hardOpenRouterConstraints, isOpenRouterURL } from '../../src/utils/openrouterRequest';
import { officialAPIEndpoint } from '../../src/store/provider-config';
import type { BubbleSummary, ChatInterface, ConfigInterface, MessageInterface, TotalTokenUsed } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';

type Input = { operation: 'select' | 'plan' | 'apply' | 'mutate' | 'describe'; chat: ChatInterface;
  sourceNodeIds?: string[]; mode?: BubbleSummary['mode']; originNodeId?: string; format?: BubbleSummary['format'];
  config?: ConfigInterface; settings?: SummarySettings; summaryId?: string; now?: number; generatingNodeIds?: string[]; busyJobs?: BusySummaryJob[];
  selection?: SummarySelection; modelState?: ReasoningModelState;
  transport?: { endpointURL: { protocol: string; hostname: string }; hasApiKey: boolean; apiVersion?: string; customHeaders?: Record<string, string>; viaProxy?: boolean };
  responseText?: string; finishReason?: string; stale?: boolean; countTotalTokens?: boolean; totalTokenUsed?: TotalTokenUsed;
  action?: 'remove' | 'use' | 'target'; nodeId?: string; use?: boolean; chosenSummaryId?: string };

export function summaryOperation(json: string): string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'describe') {
    if (!input.nodeId) throw new Error('Missing summary node.');
    return JSON.stringify(describeBubbleSummary(input.chat, input.nodeId, input.generatingNodeIds,
      input.chosenSummaryId, input.mode, input.originNodeId));
  }
  if (input.operation === 'mutate') {
    const chat = input.action === 'remove' && input.summaryId ? removeBubbleSummary(input.chat, input.summaryId)
      : input.action === 'use' && input.summaryId ? setSummaryForSubmit(input.chat, input.summaryId, !!input.use)
        : input.action === 'target' && input.nodeId ? toggleSummaryTarget(input.chat, input.nodeId,
          (input.chat.branchTree?.activePath ?? input.chat.messages.map((_, index) => String(index))).indexOf(input.nodeId)) : input.chat;
    return JSON.stringify({ changes: diffJSONChanges(input.chat, chat) });
  }
  if (input.operation === 'select') {
    if (!input.sourceNodeIds || !input.mode || !input.originNodeId || !input.settings || !input.summaryId || input.now === undefined)
      throw new Error('Missing summary selection input.');
    return JSON.stringify(selectBubbleSummary(input.chat, input.sourceNodeIds, input.mode, input.originNodeId,
      input.format, input.config ?? input.chat.config, input.settings, input.summaryId, input.now,
      input.generatingNodeIds, input.busyJobs));
  }
  if (input.operation === 'plan') {
    if (!input.selection || !input.transport) throw new Error('Missing summary selection or transport.');
    const selection = input.selection;
    if (!input.transport.hasApiKey && selection.endpoint === officialAPIEndpoint) throw new Error('noApiKeyWarning');
    if (hardOpenRouterConstraints(selection.config.openRouter) && !isOpenRouterURL(input.transport.endpointURL))
      throw new Error('OpenRouter auxiliary constraints require an OpenRouter endpoint.');
    // shortcut: JSC has no Web tokenizer worker; replace this estimate when a native tokenizer adapter exists.
    const context = remoteModelContextInfo(input.modelState ?? {}, selection.model, selection.providerId).contextLength;
    if (!fitsContextWindow(estimateTokensByChars([selection.promptMessage]), context, selection.config.max_tokens))
      throw new Error('要約対象がモデルのコンテキスト上限を超えています');
    const request = JSON.parse(generationRequest(JSON.stringify({ auxiliary: true, messages: [selection.promptMessage],
      config: selection.config, modelState: input.modelState,
      transport: { endpoint: selection.endpoint, endpointURL: input.transport.endpointURL,
        hasApiKey: input.transport.hasApiKey, apiVersion: input.transport.apiVersion,
        customHeaders: input.transport.customHeaders, viaProxy: input.transport.viaProxy } })));
    return JSON.stringify({ request });
  }
  if (input.operation === 'apply') {
    if (!input.selection || typeof input.responseText !== 'string') throw new Error('Missing summary selection or response.');
    const selection = input.selection;
    const text = normalizeBubbleSummaryText(input.responseText);
    if (!text) throw new Error('要約を生成できませんでした');
    // Web updateTotalTokenUsed runs for every nonblank response, independent of the UI count setting.
    const before = { chat: input.chat, totalTokenUsed: input.totalTokenUsed ?? {} };
    const after = { ...before };
    const completion: MessageInterface = { role: 'assistant', content: [{ type: 'text', text }] };
    after.totalTokenUsed = addTokenUsage(input.totalTokenUsed ?? {}, selection.model, selection.providerId,
      estimateTokensByChars([selection.promptMessage]), estimateTokensByChars([completion]), 0);
    const metadata = { usageKey: selection.providerId ? `${selection.model}:::${selection.providerId}` : selection.model,
      counterFields: ['promptTokens', 'completionTokens', 'imageTokens'] };
    if (input.stale) return JSON.stringify({ changes: diffJSONChanges(before, after), ...metadata,
      error: '対象の原文や設定が変わりました。対象を確認して生成し直してください。' });
    if (input.finishReason === 'length') return JSON.stringify({ changes: diffJSONChanges(before, after), ...metadata,
      error: '出力上限で要約が途中で終了しました。上限を調整して生成し直してください' });
    try {
      const saved = { ...selection.summary, text };
      const path = input.chat.branchTree?.activePath ?? input.chat.messages.map((_, index) => String(index));
      const indices = selection.sourceNodeIds.map(id => path.indexOf(id));
      if (indices.some(index => index < 0)) throw new Error('対象の原文や状態が変わりました。対象を確認して生成し直してください。');
      const originalTokens = estimateTokensByChars(indices.map(index => input.chat.messages[index]));
      const replacementTokens = estimateTokensByChars([bubbleSummarySubmitMessage(saved)]);
      const result = evaluateBubbleSummary(input.chat, selection, text, input.generatingNodeIds, originalTokens, replacementTokens);
      after.chat = result.chat;
      return JSON.stringify({ changes: diffJSONChanges(before, after), summary: result.summary,
        savesTokens: result.savesTokens, warning: result.warning, ...metadata });
    } catch (error) {
      return JSON.stringify({ changes: diffJSONChanges(before, after), error: error instanceof Error ? error.message : '要約を生成できませんでした。', ...metadata });
    }
  }
  throw new Error('Unknown summary operation.');
}
