import type { ChatInterface, FolderCollection } from '@type/chat';
import { getFolderAncestors, getFolderParentId, validateFolderHierarchy } from './folderHierarchy';

export type FolderPatch = { name?: string; color?: string | null; expanded?: boolean; parentId?: string | null };
export type FolderOperation =
  | { type: 'create'; id: string }
  | { type: 'edit'; id: string; patch: FolderPatch }
  | { type: 'rename'; id: string; name: string }
  | { type: 'color'; id: string; color?: string }
  | { type: 'expanded'; id: string; expanded: boolean }
  | { type: 'remove'; id: string }
  | { type: 'move'; chatIds: string[]; folderId?: string; expandDestination?: boolean };

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
    if (operation.folderId === undefined && operation.expandDestination === true) throw new Error('Unassigned destination cannot expand.');
    const ids = new Set(operation.chatIds);
    if ([...ids].some(id => !source.chats?.some(chat => chat.id === id))) throw new Error('Chat does not exist.');
    const chats = source.chats?.map(chat => {
      if (!ids.has(chat.id)) return chat;
      const { folder: _previous, ...rest } = chat;
      return operation.folderId === undefined ? rest : { ...rest, folder: operation.folderId };
    });
    const folders = operation.folderId === undefined || operation.expandDestination === false ? source.folders : {
      ...source.folders, ...Object.fromEntries(getFolderAncestors(source.folders, operation.folderId).map(id => [id, { ...source.folders[id], expanded: true }])),
    };
    return { ...source, chats, folders };
  }
  if (!Object.hasOwn(source.folders, operation.id)) throw new Error('Folder does not exist.');
  if (operation.type === 'remove') {
    const parentId = getFolderParentId(source.folders, operation.id);
    const folders = { ...source.folders };
    delete folders[operation.id];
    for (const [id, folder] of Object.entries(folders)) if (folder.parentId === operation.id) {
      const { parentId: _previous, ...rest } = folder;
      folders[id] = parentId === undefined ? rest : { ...rest, parentId };
    }
    const chats = source.chats?.map(chat => {
      if (chat.folder !== operation.id) return chat;
      const { folder: _previous, ...rest } = chat;
      return parentId === undefined ? rest : { ...rest, folder: parentId };
    });
    return { ...source, chats, folders };
  }
  const patch: FolderPatch = operation.type === 'edit' ? operation.patch : operation.type === 'rename' ? { name: operation.name }
    : operation.type === 'expanded' ? { expanded: operation.expanded } : { color: operation.color || null };
  const previous = source.folders[operation.id];
  const folder = { ...previous, ...patch, color: patch.color === null ? undefined : patch.color ?? previous.color };
  if (folder.color === undefined) delete folder.color;
  const folders = { ...source.folders, [operation.id]: folder };
  if (!validateFolderHierarchy(folders)) throw new Error('Invalid folder hierarchy.');
  return { ...source, folders };
}
