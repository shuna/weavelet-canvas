import { addLibraryChat, createLibraryChat, deleteLibraryChats, duplicateLibraryChat, renameLibraryChat } from '../../src/utils/chatLibrary';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import type { ChatInterface, ConfigInterface, ImageDetail } from '../../src/types/chat';
import type { ContentStoreData } from '../../src/utils/contentStore';

type LibraryInput = {
  chats: ChatInterface[];
  contentStore: ContentStoreData;
  operation: { type: 'create' | 'rename' | 'duplicate' | 'delete'; id?: string; newID?: string; ids?: string[]; title?: string; folder?: string };
  defaults?: { config: ConfigInterface; imageDetail: ImageDetail };
};
export function libraryOperation(json: string): string {
  const input = JSON.parse(json) as LibraryInput;
  const { chats, contentStore, operation } = input;
  const indexOf = (id: string | undefined) => {
    const index = chats.findIndex(chat => chat.id === id);
    if (index < 0) throw new Error('Unknown chat ID.');
    return index;
  };
  const validateNewID = () => {
    if (!operation.newID || chats.some(chat => chat.id === operation.newID)) throw new Error('Invalid new chat ID.');
  };
  const create = (title?: string) => {
    validateNewID();
    if (!input.defaults) throw new Error('Missing chat defaults.');
    return createLibraryChat(operation.newID!, title, input.defaults.config,
      input.defaults.imageDetail, input.defaults.config.systemPrompt, operation.folder);
  };
  let next = { chats, contentStore };
  switch (operation.type) {
    case 'create': next = { chats: addLibraryChat(chats, create), contentStore }; break;
    case 'rename':
      if (typeof operation.title !== 'string') throw new Error('Invalid chat title.');
      next = { chats: renameLibraryChat(chats, indexOf(operation.id), operation.title), contentStore }; break;
    case 'duplicate':
      validateNewID();
      next = duplicateLibraryChat(chats, indexOf(operation.id), contentStore, operation.newID); break;
    case 'delete': {
      if (!operation.ids?.length || new Set(operation.ids).size !== operation.ids.length) throw new Error('Invalid chat selection.');
      next = deleteLibraryChats(chats, operation.ids.map(indexOf), contentStore, create); break;
    }
    default: throw new Error('Unknown library operation.');
  }
  return JSON.stringify(diffJSONChanges({ chats, contentStore }, next));
}
