import { generationRequest } from './generation';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { addTokenUsage, autoTitlePrompt, estimateTokensByChars, normalizeGeneratedTitle, TITLE_DEFAULTS, titleRequestSettings, type TitleSettings } from '../../src/utils/chatTitle';
import { countImageInputs } from '../../src/utils/cost';
import { DEFAULT_PROVIDERS } from '../../src/store/provider-config';
import { hardOpenRouterConstraints, isOpenRouterURL } from '../../src/utils/openrouterRequest';
import { officialAPIEndpoint } from '../../src/constants/auth';
import type { ChatInterface, ConfigInterface, MessageInterface, TotalTokenUsed } from '../../src/types/chat';
import type { ReasoningModelState } from '../../src/utils/modelReasoning';

type Selection = { status: 'ready'; model: string; providerId?: string; credentialProviderId?: string; endpoint: string;
  config: ConfigInterface; promptMessage: MessageInterface };
type Input = { operation: 'select' | 'plan' | 'apply' | 'settings' | 'saveSettings'; chat: ChatInterface; autoTitle?: boolean; language?: string;
  sourceConfig?: ConfigInterface; settings?: TitleSettings; selection?: Selection; responseText?: string;
  transport?: { hasApiKey: boolean; apiVersion?: string; customHeaders?: Record<string, string>; viaProxy?: boolean };
  modelState?: ReasoningModelState; capabilities?: { supportsReasoning: boolean; requiresReasoning: boolean };
  countTotalTokens?: boolean; totalTokenUsed?: TotalTokenUsed;
  state?: Record<string, unknown>; value?: { autoTitle: boolean; titleModel: string; titleProviderId?: string } };

/** The same title policy drives the Web caller and the native JSON bridge. */
export function titleOperation(json: string): string {
  const input = JSON.parse(json) as Input;
  if (input.operation === 'settings') {
    const state = input.state ?? {};
    return JSON.stringify({ autoTitle: typeof state.autoTitle === 'boolean' ? state.autoTitle : TITLE_DEFAULTS.autoTitle,
      titleModel: typeof state.titleModel === 'string' ? state.titleModel : TITLE_DEFAULTS.titleModel,
      titleProviderId: typeof state.titleProviderId === 'string' ? state.titleProviderId : TITLE_DEFAULTS.titleProviderId });
  }
  if (input.operation === 'saveSettings') {
    const value = input.value;
    if (!value || typeof value.autoTitle !== 'boolean' || typeof value.titleModel !== 'string'
      || (value.titleProviderId !== undefined && !Object.hasOwn(DEFAULT_PROVIDERS, value.titleProviderId))) throw new Error('Invalid title settings.');
    const state = input.state ?? {};
    const before = Object.fromEntries(['autoTitle', 'titleModel', 'titleProviderId']
      .filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]));
    const after: Record<string, unknown> = { ...before, autoTitle: value.autoTitle, titleModel: value.titleModel };
    if (value.titleProviderId !== undefined) after.titleProviderId = value.titleProviderId;
    else delete after.titleProviderId;
    return JSON.stringify({ changes: diffJSONChanges(before, after) });
  }
  if (input.operation === 'select') {
    if (!input.settings || input.language === undefined) throw new Error('Missing title settings.');
    const promptMessage = autoTitlePrompt(input.chat, !!input.autoTitle, input.language);
    if (!promptMessage) return JSON.stringify({ status: 'skipped' });
    const { model, providerId, credentialProviderId, provider, config } = titleRequestSettings(input.sourceConfig ?? input.chat.config, input.settings);
    if (hardOpenRouterConstraints((input.sourceConfig ?? input.chat.config).openRouter)
      && !isOpenRouterURL(new URL(provider.endpoint))) throw new Error('OpenRouter auxiliary constraints require an OpenRouter endpoint.');
    return JSON.stringify({ status: 'ready', model, providerId, credentialProviderId, endpoint: provider.endpoint, config, promptMessage } satisfies Selection);
  }
  if (input.operation === 'plan') {
    if (!input.selection || !input.transport) throw new Error('Missing title selection or transport.');
    const selection = input.selection;
    if (selection.status !== 'ready') throw new Error('Invalid title selection.');
    if (!input.transport.hasApiKey && selection.endpoint === officialAPIEndpoint) throw new Error('noApiKeyWarning');
    const url = new URL(selection.endpoint);
    const request = JSON.parse(generationRequest(JSON.stringify({
      auxiliary: true, messages: [selection.promptMessage], config: selection.config,
      modelState: input.modelState, capabilities: input.capabilities,
      transport: { endpoint: selection.endpoint, endpointURL: { protocol: url.protocol, hostname: url.hostname },
        hasApiKey: input.transport.hasApiKey, apiVersion: input.transport.apiVersion,
        customHeaders: input.transport.customHeaders, viaProxy: input.transport.viaProxy },
    })));
    return JSON.stringify({ status: 'ready', request, model: selection.model, providerId: selection.providerId,
      promptMessage: selection.promptMessage });
  }
  if (input.operation === 'apply') {
    if (!input.selection || typeof input.responseText !== 'string') throw new Error('Missing title selection or response.');
    if (input.chat.titleSet) return JSON.stringify({ status: 'skipped', changes: [] });
    const title = normalizeGeneratedTitle(input.responseText);
    const chat = { ...input.chat, title, titleSet: true };
    const assistantMessage: MessageInterface = { role: 'assistant', content: [{ type: 'text', text: title }] };
    const before = { chat: input.chat, ...(input.countTotalTokens ? { totalTokenUsed: input.totalTokenUsed ?? {} } : {}) };
    const after: { chat: ChatInterface; totalTokenUsed?: TotalTokenUsed } = { ...before, chat };
    if (input.countTotalTokens) {
      // shortcut: JSC has no Web tokenizer worker; replace these counts when a native tokenizer adapter exists.
      after.totalTokenUsed = addTokenUsage(input.totalTokenUsed ?? {}, input.selection.model, input.selection.providerId,
        estimateTokensByChars([input.selection.promptMessage]), estimateTokensByChars([assistantMessage]),
        countImageInputs([input.selection.promptMessage]));
    }
    return JSON.stringify({ status: 'updated', title, changes: diffJSONChanges(before, after),
      usage: { model: input.selection.model, providerId: input.selection.providerId,
        promptMessage: input.selection.promptMessage, assistantMessage } });
  }
  throw new Error('Unknown title operation.');
}
