import type { BubbleSummary, ChatInterface, ConfigInterface, MessageInterface } from '@type/chat';
import type { FavoriteModel, ProviderConfig, ProviderId } from '@type/provider';
import { isTextContent } from '@type/chat';
import { bubbleSummarySubmitMessage, getSubmittableBubbleSummaries, isBubbleSummary, isSummaryEligible, normalizeBubbleSummaryText, resolveValidSummary } from './bubbleSummary';
import { buildBubbleSummaryPrompt } from './bubbleSummaryPrompt';
import { resolveProviderForModel } from './chatTitle';
import { hardOpenRouterConstraints } from './openrouterRequest';
import { pickModelSettings } from './modelSettingsCore';

export type SummarySettings = { favoriteModels: FavoriteModel[]; providers: Partial<Record<ProviderId, ProviderConfig>>; fallbackProvider: { endpoint: string; key?: string } };
export type SummarySelection = { status: 'ready'; summary: BubbleSummary; config: ConfigInterface; promptMessage: MessageInterface;
  model: string; providerId?: ProviderId; credentialProviderId?: ProviderId; endpoint: string; sourceNodeIds: string[]; chatModel: string };
export type BusySummaryJob = { originNodeId: string; sourceNodeIds: string[] };

export function prepareBubbleSummaryRequest(messages: MessageInterface[], config: ConfigInterface,
  settings: SummarySettings, format?: BubbleSummary['format']) {
  if (config.modelSource === 'local') throw new Error('ローカルモデルでは要約生成を利用できません');
  if (messages.some(message => !isSummaryEligible(message))) throw new Error('要約対象にできないバブルが含まれています');
  const credentialProviderId = config.providerId ?? settings.favoriteModels.find(entry => entry.modelId === config.model)?.providerId;
  const provider = resolveProviderForModel(config.model, settings.favoriteModels, settings.providers, settings.fallbackProvider, config.providerId);
  return { config: { ...config, openRouter: { routing: hardOpenRouterConstraints(config.openRouter), responseCache: { mode: 'off' as const } } },
    promptMessage: { role: 'user' as const, content: [{ type: 'text' as const, text: buildBubbleSummaryPrompt(messages, format) }] },
    model: config.model, providerId: config.providerId, credentialProviderId, endpoint: provider.endpoint, key: provider.key };
}

export function summarySources(chat: ChatInterface, sourceNodeIds: string[], mode: BubbleSummary['mode'], originNodeId: string,
  generatingNodeIds: string[] = []): BubbleSummary['sources'] {
  const path = chat.branchTree?.activePath ?? chat.messages.map((_, index) => String(index));
  const indices = sourceNodeIds.map(id => path.indexOf(id));
  if (!indices.length || indices.some(index => index < 0) || new Set(indices).size !== indices.length
    || indices.some((index, offset) => index !== indices[0] + offset) || (mode === 'single' && indices.length !== 1)
    || (mode === 'single' && sourceNodeIds[0] !== originNodeId)
    || (mode === 'through' && sourceNodeIds.at(-1) !== originNodeId)
    || indices.some(index => !isSummaryEligible(chat.messages[index]) || generatingNodeIds.includes(path[index]))) {
    throw new Error('同じ経路の連続した通常テキストを選択してください。画像・ツール・生成中のバブルは対象外です。');
  }
  return indices.map(index => ({ nodeId: path[index], parentId: chat.branchTree?.nodes[path[index]]?.parentId ?? null,
    role: chat.messages[index].role as 'user' | 'assistant', textParts: chat.messages[index].content.filter(isTextContent).map(value => value.text) }));
}

export function overlapsBusySummary(originNodeId: string, sourceNodeIds: string[], busyJobs: BusySummaryJob[] = []): boolean {
  return busyJobs.some(job => job.originNodeId === originNodeId || job.sourceNodeIds.some(id => sourceNodeIds.includes(id)));
}

export function selectBubbleSummary(chat: ChatInterface, sourceNodeIds: string[], mode: BubbleSummary['mode'], originNodeId: string,
  format: BubbleSummary['format'], config: ConfigInterface, settings: SummarySettings, summaryId: string, now: number,
  generatingNodeIds: string[] = [], busyJobs: BusySummaryJob[] = []): SummarySelection {
  const sources = summarySources(chat, sourceNodeIds, mode, originNodeId, generatingNodeIds);
  if (overlapsBusySummary(originNodeId, sourceNodeIds, busyJobs)) throw new Error('要約の生成中です');
  const previous = chat.summaries?.find(summary => summary.mode === mode && summary.format === format
    && summary.sources.length === sources.length && summary.sources.every((source, index) => source.nodeId === sources[index].nodeId));
  const summary: BubbleSummary = { ...previous, id: previous?.id ?? summaryId, mode, format,
    sources: sources.map((source, index) => ({ ...previous?.sources[index], ...source })), text: '', useForSubmit: false,
    generation: { ...previous?.generation, model: config.model, providerId: config.providerId, createdAt: now,
      settings: { ...pickModelSettings(config), stream: false, openRouter: { routing: hardOpenRouterConstraints(config.openRouter), responseCache: { mode: 'off' } } } } };
  const path = chat.branchTree?.activePath ?? chat.messages.map((_, index) => String(index));
  const indices = sourceNodeIds.map(id => path.indexOf(id));
  const messages = indices.map(index => chat.messages[index]);
  const prepared = prepareBubbleSummaryRequest(messages, config, settings, format);
  return { status: 'ready', summary, config: prepared.config, promptMessage: prepared.promptMessage,
    model: prepared.model, providerId: prepared.providerId, credentialProviderId: prepared.credentialProviderId,
    endpoint: prepared.endpoint, sourceNodeIds, chatModel: chat.config.model };
}

export function saveBubbleSummary(chat: ChatInterface, summary: BubbleSummary): ChatInterface {
  if (!isBubbleSummary(summary)) return chat;
  return { ...chat, summaries: [...(Array.isArray(chat.summaries) ? chat.summaries.filter(item => item.id !== summary.id) : []), summary] };
}
export function removeBubbleSummary(chat: ChatInterface, summaryId: string): ChatInterface {
  return { ...chat, summaries: chat.summaries?.filter(summary => summary.id !== summaryId) };
}
export function setSummaryForSubmit(chat: ChatInterface, summaryId: string, use: boolean): ChatInterface {
  if (!Array.isArray(chat.summaries)) return chat;
  const chosen = chat.summaries.find(summary => summary.id === summaryId);
  if (!chosen) return chat;
  const overlaps = (left: BubbleSummary, right: BubbleSummary) => left.sources.some(source => right.sources.some(other => source.nodeId === other.nodeId));
  return { ...chat, summaries: chat.summaries.map(summary => ({ ...summary,
    useForSubmit: summary.id === summaryId ? use : overlaps(summary, chosen) ? false : summary.useForSubmit })) };
}
export function toggleSummaryTarget(chat: ChatInterface, nodeId: string, messageIndex: number): ChatInterface {
  if (!isSummaryEligible(chat.messages[messageIndex])) return chat;
  const summaryTargets = { ...(chat.summaryTargets ?? {}) };
  if (summaryTargets[nodeId]) delete summaryTargets[nodeId]; else summaryTargets[nodeId] = true;
  return { ...chat, summaryTargets };
}

export function evaluateBubbleSummary(chat: ChatInterface, selection: SummarySelection, responseText: string,
  generatingNodeIds: string[] = [], originalTokens?: number, replacementTokens?: number) {
  const text = normalizeBubbleSummaryText(responseText);
  if (!text) throw new Error('要約を生成できませんでした');
  const saved = { ...selection.summary, text };
  if (!resolveValidSummary(chat, saved, generatingNodeIds)) throw new Error('対象の原文や状態が変わりました。対象を確認して生成し直してください。');
  const prior = chat.summaries?.find(summary => summary.id === saved.id);
  if (prior && (prior.mode !== saved.mode || prior.format !== saved.format || prior.sources.length !== saved.sources.length
    || prior.sources.some((source, index) => source.nodeId !== saved.sources[index]?.nodeId)))
    throw new Error('対象の原文や状態が変わりました。対象を確認して生成し直してください。');
  if (chat.config.model !== selection.chatModel) throw new Error('対象の原文や設定が変わりました。対象を確認して生成し直してください。');
  const savesTokens = originalTokens !== undefined && replacementTokens !== undefined ? replacementTokens < originalTokens : undefined;
  const warning = savesTokens === false ? `送信内容の推定トークン数を削減できませんでした（原文 ${originalTokens} → ${replacementTokens} tokens）。生成文は保存しましたが、原文を表示・送信します。必要なら要約・圧縮を明示的に選択できます。` : undefined;
  return { summary: saved, chat: saveBubbleSummary(chat, saved), savesTokens, warning,
    replacementMessage: bubbleSummarySubmitMessage(saved) };
}

export function savedBubbleSummaryVersions(candidates: BubbleSummary[], summary?: BubbleSummary) {
  return candidates.filter(value => value.format === summary?.format).map(value => ({ id: value.id,
    label: `${value.sources.length}件 · ${normalizeBubbleSummaryText(value.text).slice(0, 32)}` }));
}

export function describeBubbleSummary(chat: ChatInterface, nodeId: string, generatingNodeIds: string[] = [], chosenSummaryId?: string,
  mode: BubbleSummary['mode'] = 'single', originNodeId: string = nodeId) {
  const pathIds = chat.branchTree?.activePath ?? chat.messages.map((_, index) => String(index));
  const path = pathIds.map((id, index) => ({ nodeId: id, role: chat.messages[index]?.role,
    text: chat.messages[index]?.content.filter(isTextContent).map(value => value.text).join('\n').slice(0, 240) ?? '',
    eligible: isSummaryEligible(chat.messages[index]) && !generatingNodeIds.includes(id), targeted: !!chat.summaryTargets?.[id] }));
  const end = pathIds.indexOf(originNodeId);
  const sourceNodeIds = mode === 'single' ? end < 0 ? [] : [originNodeId] : mode === 'through'
    ? pathIds.slice(0, end + 1).filter((_, index) => chat.messages[index]?.role !== 'system')
    : pathIds.filter(id => chat.summaryTargets?.[id]);
  const candidates = (Array.isArray(chat.summaries) ? chat.summaries : []).filter(isBubbleSummary)
    .filter(summary => summary.sources.some(source => source.nodeId === nodeId));
  const applied = getSubmittableBubbleSummaries(chat, chat.messages.length, generatingNodeIds);
  const summary = candidates.find(value => applied.some(item => item.summary.id === value.id))
    ?? candidates.find(value => value.id === chosenSummaryId) ?? candidates.at(-1);
  const range = summary ? resolveValidSummary(chat, summary, generatingNodeIds) : null;
  const tab = applied.some(value => value.summary.id === summary?.id) ? summary?.format === 'compact' ? 'compact' : 'summary' : 'original';
  const versions = candidates.filter(value => summary && value.sources.length === summary.sources.length && value.sources.every((source, index) => source.nodeId === summary.sources[index].nodeId));
  const readable = versions.find(value => value.id === chosenSummaryId && value.format !== 'compact') ?? versions.filter(value => value.format !== 'compact').at(-1);
  const compact = versions.find(value => value.id === chosenSummaryId && value.format === 'compact') ?? versions.filter(value => value.format === 'compact').at(-1);
  const anchor = summary?.sources.at(-1)?.nodeId;
  return { eligible: path[pathIds.indexOf(nodeId)]?.eligible ?? false, selectedTarget: !!chat.summaryTargets?.[nodeId], path, sourceNodeIds,
    candidates, summary, readable, compact, chosenSummaryId, valid: !!range, range, tab,
    anchor, savedVersions: savedBubbleSummaryVersions(candidates, summary), hidden: !!summary && tab !== 'original' && anchor !== nodeId };
}
