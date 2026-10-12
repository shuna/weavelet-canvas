import type { FolderCollection } from '@type/chat';

export function validateFolderHierarchy(folders: unknown): folders is FolderCollection {
  if (!folders || typeof folders !== 'object' || Array.isArray(folders)) return false;
  const collection = folders as FolderCollection;
  for (const [id, folder] of Object.entries(collection)) {
    if (!id || !folder || typeof folder !== 'object' || folder.id !== id ||
        typeof folder.name !== 'string' || !Number.isFinite(folder.order) ||
        typeof folder.expanded !== 'boolean' ||
        (folder.parentId != null && (typeof folder.parentId !== 'string' || !Object.hasOwn(collection, folder.parentId)))) return false;
  }
  const finished = new Set<string>();
  for (const id of Object.keys(collection)) {
    const path = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !finished.has(current)) {
      if (path.has(current)) return false;
      path.add(current);
      current = collection[current].parentId ?? undefined;
    }
    for (const member of path) finished.add(member);
  }
  return true;
}

// Corrupt persisted chains remain visible at the root rather than disappearing.
export function getFolderParentId(folders: FolderCollection, id: string): string | undefined {
  const parent = folders[id]?.parentId ?? undefined;
  const visited = new Set([id]);
  let current = parent;
  while (current !== undefined) {
    if (visited.has(current) || !Object.hasOwn(folders, current)) return undefined;
    visited.add(current);
    current = folders[current]?.parentId ?? undefined;
  }
  return parent;
}

// Own folder first, followed by its nearest ancestors.
export function getFolderAncestors(folders: FolderCollection, id: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && Object.hasOwn(folders, current) && !visited.has(current)) {
    visited.add(current);
    result.push(current);
    current = result.length === 1 ? getFolderParentId(folders, current) : folders[current]?.parentId ?? undefined;
  }
  return result;
}

export function getFolderSubtreeIds(folders: FolderCollection, id: string): string[] {
  if (!Object.hasOwn(folders, id)) return [];
  const children = new Map<string, string[]>();
  for (const [childId, folder] of Object.entries(folders)) {
    if (folder?.parentId != null) {
      const list = children.get(folder.parentId) ?? [];
      list.push(childId);
      children.set(folder.parentId, list);
    }
  }
  const result: string[] = [], visited = new Set<string>(), pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    for (const child of children.get(current) ?? []) pending.push(child);
  }
  return result;
}
