import type { ChatInterface, FolderCollection } from '@type/chat';

export type FolderOperation =
  | { type: 'create'; id: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'color'; id: string; color?: string }
  | { type: 'expanded'; id: string; expanded: boolean }
  | { type: 'remove'; id: string }
  | { type: 'move'; chatIds: string[]; folderId?: string };

export const orderedFolders = (folders: FolderCollection) => Object.values(folders).sort((a, b) => a.order - b.order);

export function applyFolderOperation<T extends { folders: FolderCollection; chats?: ChatInterface[] }>(source: T, operation: FolderOperation): T {
  if (operation.type === 'create') {
    if (!operation.id || Object.hasOwn(source.folders, operation.id)) throw new Error('Folder ID already exists.');
    let index = 1;
    while (Object.values(source.folders).some(folder => folder.name === `New Folder ${index}`)) index++;
    const previous = Object.fromEntries(Object.entries(source.folders).map(([id, folder]) => [id, { ...folder, order: folder.order + 1 }]));
    return { ...source, folders: { [operation.id]: { id: operation.id, name: `New Folder ${index}`, expanded: false, order: 0 }, ...previous } };
  }
  if (operation.type === 'move') {
    if (operation.folderId !== undefined && !Object.hasOwn(source.folders, operation.folderId)) throw new Error('Folder does not exist.');
    const ids = new Set(operation.chatIds);
    if ([...ids].some(id => !source.chats?.some(chat => chat.id === id))) throw new Error('Chat does not exist.');
    const chats = source.chats?.map(chat => {
      if (!ids.has(chat.id)) return chat;
      const { folder: _previous, ...rest } = chat;
      return operation.folderId === undefined ? rest : { ...rest, folder: operation.folderId };
    });
    const folders = operation.folderId === undefined ? source.folders : {
      ...source.folders, [operation.folderId]: { ...source.folders[operation.folderId], expanded: true },
    };
    return { ...source, chats, folders };
  }
  if (!Object.hasOwn(source.folders, operation.id)) throw new Error('Folder does not exist.');
  if (operation.type === 'remove') {
    const folders = { ...source.folders };
    delete folders[operation.id];
    const chats = source.chats?.map(chat => {
      if (chat.folder !== operation.id) return chat;
      const { folder: _previous, ...rest } = chat;
      return rest;
    });
    return { ...source, chats, folders };
  }
  const folder = { ...source.folders[operation.id] };
  if (operation.type === 'rename') folder.name = operation.name;
  else if (operation.type === 'expanded') folder.expanded = operation.expanded;
  else if (operation.color) folder.color = operation.color;
  else delete folder.color;
  return { ...source, folders: { ...source.folders, [operation.id]: folder } };
}
