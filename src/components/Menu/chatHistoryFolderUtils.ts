import type { FolderCollection } from '@type/chat';

export const expandExistingFolder = (
  folders: FolderCollection,
  folderId: string
): FolderCollection | null => {
  const folder = folders[folderId];
  if (!folder || folder.expanded) return null;

  return {
    ...folders,
    [folderId]: {
      ...folder,
      expanded: true,
    },
  };
};

// Drag payloads come from the browser and may belong to another page.
export const readDraggedChatIds = (data: string): string[] | null => {
  try {
    const ids: unknown = JSON.parse(data);
    return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? ids : null;
  } catch {
    return null;
  }
};
