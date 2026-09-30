import { mergeBranches } from './mergeBranches';
import type { BranchTree } from '@type/chat';
import { digest } from './crypto';
import type { Records } from './records';
import { fromRecordsAsync as fromRecords, toRecordsAsync as toRecords } from './processing';

// Merge independent fields and message branches. Conflicting metadata retains complete copies.
// Settings conflicts use the local value; the resolution UI states this explicitly.
export async function mergeSyncRecords(base: Records, local: Records, cloud: Records): Promise<Records> {
  const merged = { ...cloud };
  const chats = new Set<string>();
  const localEdits = new Set<string>(), cloudEdits = new Set<string>();
  const folders = new Map<string, string>();
  const set = (key: string, value?: string) => { if (value === undefined) delete merged[key]; else merged[key] = value; };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(cloud)])) {
    const left = local[key], right = cloud[key];
    const leftHash = left === undefined ? undefined : await digest(left);
    const rightHash = right === undefined ? undefined : await digest(right);
    const recordPath = JSON.parse(key) as string[];
    if (recordPath[0] === 'chats' && recordPath[1]) {
      if (leftHash !== base[key]) localEdits.add(recordPath[1]);
      if (rightHash !== base[key]) cloudEdits.add(recordPath[1]);
    }
    if (left === right || leftHash === base[key]) continue;
    if (rightHash === base[key]) { set(key, left); continue; }
    const path = JSON.parse(key) as string[];
    if (path[0] === 'chats' && path[1]) {
      if (path[2] !== 'branchTree') chats.add(path[1]);
    }
    else if (path[0] === 'state' && path[1] === 'folders' && path[2]) folders.set(path[2], crypto.randomUUID());
    else if (path[0] === 'order') {
      merged[key] = JSON.stringify([...new Set([...JSON.parse(right ?? '[]'), ...JSON.parse(left ?? '[]')])]);
    } else set(key, left);
  }
  const localSnapshot = await fromRecords(local);
  const cloudSnapshot = await fromRecords(cloud);
  for (const chat of localSnapshot.state.chats ?? []) if (chat.folder && folders.has(chat.folder)) chats.add(chat.id);
  const copyEntity = (prefix: string[], newId?: string) => {
    for (const key of Object.keys(merged)) {
      const path = JSON.parse(key) as string[];
      if (prefix.every((part, i) => path[i] === part)) delete merged[key];
    }
    for (const [key, value] of Object.entries(cloud)) {
      const path = JSON.parse(key) as string[];
      if (prefix.every((part, i) => path[i] === part)) merged[key] = value;
    }
    if (!newId) return;
    for (const [key, value] of Object.entries(local)) {
      const path = JSON.parse(key) as string[];
      if (!prefix.every((part, i) => path[i] === part)) continue;
      path[prefix.length - 1] = newId;
      const field = path[prefix.length];
      merged[JSON.stringify(path)] = field === 'id' ? JSON.stringify(newId)
        : field === 'folder' && folders.has(JSON.parse(value)) ? JSON.stringify(folders.get(JSON.parse(value))) : value;
    }
  };
  for (const [id, newId] of folders) copyEntity(['state', 'folders', id], localSnapshot.state.folders?.[id] ? newId : undefined);
  for (const id of chats) copyEntity(['chats', id], localSnapshot.state.chats?.some(chat => chat.id === id) ? crypto.randomUUID() : undefined);
  for (const chat of localSnapshot.state.chats ?? []) {
    const remote = cloudSnapshot.state.chats?.find(item => item.id === chat.id);
    if (chats.has(chat.id) || !localEdits.has(chat.id) || !cloudEdits.has(chat.id) || !chat.branchTree || !remote?.branchTree) continue;
    const rawTree = (records: Records, tree: BranchTree) => {
      const result = structuredClone(tree);
      for (const node of Object.values(result.nodes)) node.contentHash = JSON.parse(records[JSON.stringify(['chats', chat.id, 'branchTree', 'nodes', node.id, 'contentHash'])]);
      return result;
    };
    const { tree, localIds, cloudIds } = await mergeBranches(chat.id, base, rawTree(local, chat.branchTree), rawTree(cloud, remote.branchTree));
    for (const key of Object.keys(merged)) {
      const path = JSON.parse(key);
      if (path[0] === 'chats' && path[1] === chat.id && path[2] === 'branchTree') delete merged[key];
    }
    const put = (path: string[], value: unknown) => { merged[JSON.stringify(['chats', chat.id, ...path])] = JSON.stringify(value); };
    put(['branchTree', 'rootId'], tree.rootId); put(['branchTree', 'activePath'], tree.activePath);
    if (!Object.keys(tree.nodes).length) put(['branchTree', 'nodes'], {});
    for (const node of Object.values(tree.nodes)) for (const [field, value] of Object.entries(node)) put(['branchTree', 'nodes', node.id, field], value);
    for (const field of ['collapsedNodes', 'omittedNodes', 'protectedNodes'] as const) {
      for (const [source, ids] of [[remote, cloudIds], [chat, localIds]] as const) {
        for (const id of Object.keys(source[field] ?? {})) {
          const value = merged[JSON.stringify(['chats', chat.id, field, id])];
          if (ids[id] && ids[id] !== id && value !== undefined) put([field, ids[id]], JSON.parse(value));
        }
      }
    }
  }
  // Immutable content and images from both versions are needed by preserved copies.
  for (const [key, value] of Object.entries({ ...cloud, ...local })) if (['assets', 'content'].includes(JSON.parse(key)[0])) merged[key] = value;
  for (const key of Object.keys(merged)) {
    const path = JSON.parse(key) as string[];
    for (let i = 1; i < path.length; i++) {
      const prefix = JSON.stringify(path.slice(0, i));
      if (merged[prefix] === '{}') delete merged[prefix];
    }
  }
  // Rebuild IDs/order and validate all content references before a resolution can be published.
  try { return await toRecords(await fromRecords(merged)); }
  catch (error) {
    const structural = [...localEdits].filter(id => cloudEdits.has(id) && !chats.has(id));
    if (!structural.length) throw error;
    for (const id of structural) copyEntity(['chats', id], localSnapshot.state.chats?.some(chat => chat.id === id) ? crypto.randomUUID() : undefined);
    return toRecords(await fromRecords(merged));
  }
}
