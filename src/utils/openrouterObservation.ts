import useStore from '@store/store';
import type { OpenRouterObservation } from '@type/chat';
import { withOpenRouterObservation } from './generationUsage';

export function recordOpenRouterObservation(chatId: string, nodeId: string, patch: OpenRouterObservation): void {
  const state = useStore.getState();
  const index = state.chats?.findIndex(c => c.id === chatId) ?? -1;
  const chat = state.chats?.[index];
  if (!chat || !state.chats) return;
  const updated = withOpenRouterObservation(chat, nodeId, patch);
  if (!updated) return;
  const chats = state.chats.slice();
  chats[index] = updated;
  state.setChats(chats);
}
