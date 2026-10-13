import useStore from '@store/store';
import type { EvaluationScope, EvaluationOmittedMode } from '@type/evaluation';
import { resolveEvalContextCore, type ResolvedEvalContext } from './evaluationContextCore';
export type { ResolvedEvalContext } from './evaluationContextCore';

export function resolveEvalContext(chatIndex: number, messageIndex: number, role: string, scope: EvaluationScope, omittedMode: EvaluationOmittedMode): ResolvedEvalContext | null {
  const state = useStore.getState();
  const chat = state.chats?.[chatIndex];
  if (!chat) return null;
  return resolveEvalContextCore(chat, state.omittedNodeMaps[String(chatIndex)] ?? chat.omittedNodes ?? {}, messageIndex, role, scope, omittedMode);
}
