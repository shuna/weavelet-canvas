import { expect, it } from 'vitest';
import type { FolderCollection } from '@type/chat';
import { getFolderAncestors, getFolderParentId, getFolderSubtreeIds, validateFolderHierarchy } from './folderHierarchy';

const folder = (id: string, parentId?: string | null) => ({ id, parentId, name: id, order: 0, expanded: false });

it('accepts old root folders and traverses the own folder, ancestors and descendants', () => {
  const folders = { root: folder('root'), child: folder('child', 'root'), leaf: folder('leaf', 'child'), other: folder('other', null) };
  expect(validateFolderHierarchy(folders)).toBe(true);
  expect(getFolderParentId(folders, 'child')).toBe('root');
  expect(getFolderAncestors(folders, 'leaf')).toEqual(['leaf', 'child', 'root']);
  expect(getFolderSubtreeIds(folders, 'root')).toEqual(['root', 'child', 'leaf']);
  expect(getFolderAncestors(folders, 'missing')).toEqual([]);
});

it('rejects malformed hierarchy and terminates safe rendering traversals', () => {
  for (const folders of [null, [], { root: null }, { root: folder('mismatch') }, { '': folder('') },
    { root: folder('root', 'missing') }, { root: folder('root', 'root') },
    { root: folder('root', 'child'), child: folder('child', 'root') }]) {
    expect(validateFolderHierarchy(folders)).toBe(false);
  }
  const cyclic: FolderCollection = { root: folder('root', 'child'), child: folder('child', 'root'), leaf: folder('leaf', 'root') };
  expect(getFolderParentId(cyclic, 'leaf')).toBeUndefined();
  expect(getFolderAncestors(cyclic, 'leaf')).toEqual(['leaf']);
  expect(new Set(getFolderSubtreeIds(cyclic, 'root'))).toEqual(new Set(['root', 'child', 'leaf']));
});
