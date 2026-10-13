import { applyFolderOperation, orderedFolders, type FolderOperation } from '../../src/utils/chatFolders';
import { getFolderAncestors, getFolderParentId } from '../../src/utils/folderHierarchy';
import type { ChatInterface, FolderCollection } from '../../src/types/chat';

// Only known folder fields and chat identities/membership cross the JS boundary.
// Unknown values remain in the caller's original ordered JSON document.
type Projection = { folders: FolderCollection; chats: ChatInterface[] };
const folderFields = ['id', 'name', 'order', 'expanded', 'color', 'parentId'] as const;
function difference(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]) {
  const set = Object.fromEntries(fields.filter(key => Object.hasOwn(after, key) && (!Object.hasOwn(before, key) || before[key] !== after[key])).map(key => [key, after[key]]));
  const remove = fields.filter(key => Object.hasOwn(before, key) && !Object.hasOwn(after, key));
  return { set, remove };
}
export function folderOperation(json: string): string {
  const input = JSON.parse(json) as Projection & { operation: FolderOperation };
  const next = applyFolderOperation(input, input.operation);
  const folderChanges = Object.entries(next.folders).map(([key, folder]) => ({
    key, ...difference(Object.hasOwn(input.folders, key) ? input.folders[key] as unknown as Record<string, unknown> : {}, folder as unknown as Record<string, unknown>, folderFields),
  })).filter(change => Object.keys(change.set).length || change.remove.length);
  const chatChanges = next.chats.map((chat, index) => ({ index, ...difference(input.chats[index] as unknown as Record<string, unknown>, chat as unknown as Record<string, unknown>, ['folder']) }))
    .filter(change => Object.keys(change.set).length || change.remove.length);
  return JSON.stringify({ folderKeys: Object.keys(next.folders), folderChanges, chatChanges });
}
export function folderRows(json: string): string {
  const input = JSON.parse(json) as Pick<Projection, 'folders'>;
  for (const [id, folder] of Object.entries(input.folders)) {
    if (!id || folder?.id !== id) throw new Error('Invalid folder identity.');
  }
  const children = new Map<string, ReturnType<typeof orderedFolders>>();
  for (const folder of orderedFolders(input.folders)) {
    const parent = getFolderParentId(input.folders, folder.id) ?? '';
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  const rows: object[] = [];
  function append(parent: string, depth: number, visible: boolean) {
    for (const folder of children.get(parent) ?? []) {
      rows.push({
        ...Object.fromEntries(folderFields.filter(key => Object.hasOwn(folder, key)).map(key => [key, folder[key]])),
        displayParentId: parent,
        depth,
        visible,
        path: getFolderAncestors(input.folders, folder.id).reverse().map(id => input.folders[id].name).join(' / '),
      });
      append(folder.id, depth + 1, visible && folder.expanded);
    }
  }
  append('', 0, true);
  return JSON.stringify(rows);
}
