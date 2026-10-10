import { materializeActivePath, buildPathToLeaf } from '@utils/branchUtils';
import { normalizeSystemPrompt } from '@utils/systemPromptNormalize';
import { ensureUniqueChatIds } from '@utils/chatIdentity';
import { addContent, validateDeltaIntegrity, type ContentStoreData } from '@utils/contentStore';
import { isStreamingContentHash } from '@utils/streamingBuffer';
import type { ChatInterface } from '@type/chat';
import { isBubbleSummary } from '@utils/bubbleSummary';
import { normalizeProviderConfigs } from './provider-helpers';
import type { StoreState } from './store';
import type { PersistedStoreState } from './persistence';

function sanitizeBranchTreeReferences(chat: ChatInterface): boolean {
  if (!chat.branchTree) return false;

  let repaired = false;
  const { branchTree } = chat;
  if (!branchTree.nodes || typeof branchTree.nodes !== 'object') {
    branchTree.nodes = {};
    repaired = true;
  }

  if (!branchTree.nodes[branchTree.rootId]) {
    branchTree.rootId = Object.keys(branchTree.nodes)[0] ?? '';
    repaired = true;
  }

  const prevLen = Array.isArray(branchTree.activePath)
    ? branchTree.activePath.length
    : -1;

  if (!Array.isArray(branchTree.activePath)) {
    branchTree.activePath = [];
  }
  branchTree.activePath = branchTree.activePath.filter((id) => {
    const node = branchTree.nodes[id];
    return !!node && typeof node.contentHash === 'string';
  });

  if (branchTree.activePath.length !== prevLen) {
    repaired = true;
  }

  // Rebuild activePath when it became empty but nodes still exist
  if (
    branchTree.activePath.length === 0 &&
    branchTree.rootId &&
    branchTree.nodes[branchTree.rootId]
  ) {
    branchTree.activePath = buildPathToLeaf(branchTree, branchTree.rootId);
    repaired = true;
  }

  return repaired;
}

export const rehydrateData = (state: StoreState, savedIndex: number) => {
  state.providers = normalizeProviderConfigs(state.providers);

  // Backfill evaluationSettings fields added after initial release
  if (state.evaluationSettings) {
    if (!('safetyEngine' in state.evaluationSettings)) {
      (state.evaluationSettings as Record<string, unknown>).safetyEngine = 'remote';
    }
    if (!('hybridRemoteOnSafe' in state.evaluationSettings)) {
      (state.evaluationSettings as Record<string, unknown>).hybridRemoteOnSafe = true;
    }
  }

  let repaired = false;
  if (state.chats) {
    repaired = ensureUniqueChatIds(state.chats);
  }
  if (state.chats && state.chats.length > 0) {
    state.currentChatIndex = (savedIndex >= 0 && savedIndex < state.chats.length)
      ? savedIndex
      : 0;
  }

  const contentStore: ContentStoreData = state.contentStore ?? {};
  validateDeltaIntegrity(contentStore);
  const repairedChatTitles: string[] = [];
  state.chats?.forEach((chat: ChatInterface) => {
    if (!Array.isArray(chat.summaries)) chat.summaries = undefined;
    else chat.summaries = chat.summaries.filter(isBubbleSummary);
    if (!chat.summaryTargets || typeof chat.summaryTargets !== 'object' || Array.isArray(chat.summaryTargets)) chat.summaryTargets = undefined;
    if (!chat.messages) chat.messages = [];
    if (chat.branchTree) {
      try {
        const chatRepaired = sanitizeBranchTreeReferences(chat);
        if (chatRepaired) {
          repairedChatTitles.push(chat.title || chat.id);
        }
        // Replace orphaned streaming markers (from interrupted streams) with empty content
        for (const node of Object.values(chat.branchTree.nodes)) {
          if (isStreamingContentHash(node.contentHash)) {
            node.contentHash = addContent(contentStore, []);
          }
        }
        if (chat.branchTree.activePath.length > 0) {
          chat.messages = materializeActivePath(chat.branchTree, contentStore);
        }
      } catch (e) {
        console.warn('[rehydrate] skipping corrupt branchTree for chat', chat.id, e);
        repairedChatTitles.push(chat.title || chat.id);
      }
    }

    // Normalize system prompt: migrate system bubbles → config.systemPrompt
    try {
      normalizeSystemPrompt(chat, contentStore);
    } catch (e) {
      console.warn('[rehydrate] system prompt normalization failed for chat', chat.id, e);
    }
  });
  if (repairedChatTitles.length > 0) repaired = true;

  if (!state.verifiedStats || typeof state.verifiedStats !== 'object') {
    state.verifiedStats = {};
  }

  if (!state.pendingVerifications || typeof state.pendingVerifications !== 'object') {
    state.pendingVerifications = {};
  } else {
    const now = Date.now();
    state.pendingVerifications = Object.fromEntries(
      Object.entries(state.pendingVerifications).flatMap(([key, verification]) => {
        if (!verification || typeof verification !== 'object') {
          return [];
        }
        const normalized = {
          ...verification,
          status:
            verification.status === 'fetching' ||
            verification.status === 'pending' ||
            verification.status === 'failed'
              ? verification.status
              : 'pending',
          nextAttemptAt:
            typeof verification.nextAttemptAt === 'number'
              ? verification.nextAttemptAt
              : now,
        };
        return [[
          key,
          normalized.status === 'fetching'
            ? {
                ...normalized,
                status: 'pending',
                nextAttemptAt: Math.min(normalized.nextAttemptAt, now),
              }
            : normalized,
        ]];
      })
    );
  }

  return { repaired, repairedChatTitles };
};

export type HydrationBase = Pick<StoreState, 'chats' | 'contentStore' | 'branchClipboard' | 'providers' | 'evaluationSettings' | 'verifiedStats' | 'pendingVerifications'>;
export function prepareHydratedData({ base, persisted, savedIndex }: {
  base: Partial<HydrationBase>; persisted: Partial<PersistedStoreState>; savedIndex: number;
}) {
  const state = { ...base, ...persisted } as StoreState;
  state.contentStore ??= {};
  state.branchClipboard ??= null;
  const { repairedChatTitles } = rehydrateData(state, savedIndex);
  return { repairedChatTitles, state: {
    ...persisted, chats: state.chats, contentStore: state.contentStore ?? {},
    ...(Object.hasOwn(persisted, 'chats') ? { lastContentEditedAt: persisted.lastContentEditedAt } : {}),
    branchClipboard: state.branchClipboard ?? null,
    currentChatIndex: state.chats?.length ? state.currentChatIndex : -1,
  } };
}
