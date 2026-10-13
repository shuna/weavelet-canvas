import { chatSizeFromLengths, chatSizeLabel, type ChatSizePart } from '../../src/utils/chatSize';

export function chatSizes(json: string): string {
  const chats = JSON.parse(json) as { id: string; messages: ChatSizePart[][] }[];
  return JSON.stringify(chats.map(chat => ({ id: chat.id, label: chatSizeLabel(chatSizeFromLengths(chat.messages)) })));
}
