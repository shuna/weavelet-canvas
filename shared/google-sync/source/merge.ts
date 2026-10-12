import { getFolderSubtreeIds } from '@utils/folderHierarchy';
import { isNonBlockingRecord } from './settings';
import { mergeBranches } from './mergeBranches';
import { mergeEditTimes } from './editTimes';
import type { BranchTree } from '@type/chat';
import { digest } from './crypto';
import { isNodeOrderPath, mergeNodeOrderValues, contentEntryRefPath, contentEntryIdentity, type Records } from './records';
import { fromRecordsAsync as fromRecords, toRecordsAsync as toRecords } from './processing';

// Merge independent fields and message branches. Conflicting metadata retains complete copies.
// Settings conflicts use the local value; the resolution UI states this explicitly.
export async function mergeSyncRecords(base: Records, local: Records, cloud: Records): Promise<Records> {
  const localSnapshot = await fromRecords(local);
  const cloudSnapshot = await fromRecords(cloud);
  // Legacy readers still work; resolution upgrades their body-only entries to empty metadata.
  if (!local[JSON.stringify(['contentEntryFormat'])]) local = await toRecords(localSnapshot);
  if (!cloud[JSON.stringify(['contentEntryFormat'])]) cloud = await toRecords(cloudSnapshot);
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
    const editedChat = recordPath[0] === 'chats' ? recordPath[1] : recordPath[0] === 'contentEntryRefs' && recordPath[1] === 'chats' ? recordPath[2] : undefined;
    if (editedChat) {
      if (leftHash !== base[key]) localEdits.add(editedChat);
      if (rightHash !== base[key]) cloudEdits.add(editedChat);
    }
    if (left === right || leftHash === base[key]) continue;
    if (rightHash === base[key]) { set(key, left); continue; }
    const time = mergeEditTimes(key, [left, right]);
    if (time !== undefined) { set(key, time); continue; }
    if (isNonBlockingRecord(key)) { set(key, left); continue; }
    const path = JSON.parse(key) as string[];
    if (path[0] === 'chats' && path[1]) {
      if (path[2] !== 'branchTree') chats.add(path[1]);
    }
    else if (path[0] === 'state' && path[1] === 'folders' && path[2]) folders.set(path[2], crypto.randomUUID());
    else if (path[0] === 'order') {
      merged[key] = JSON.stringify([...new Set([...JSON.parse(right ?? '[]'), ...JSON.parse(left ?? '[]')])]);
    } else if (isNodeOrderPath(path)) {
      const value = mergeNodeOrderValues([right ?? null, left ?? null]);
      if (value === null) delete merged[key]; else merged[key] = value;
    } else set(key, left);
  }
  for (const id of [...folders.keys()]) {
    for (const descendant of getFolderSubtreeIds(localSnapshot.state.folders ?? {}, id)) {
      if (!folders.has(descendant)) folders.set(descendant, crypto.randomUUID());
    }
  }
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
    if (prefix[0] === 'chats') {
      const matches = (path: string[]) => path[0] === 'contentEntryRefs' && path[1] === 'chats' && path[2] === prefix[1];
      for (const key of Object.keys(merged)) if (matches(JSON.parse(key))) delete merged[key];
      for (const [key, value] of Object.entries(cloud)) if (matches(JSON.parse(key))) merged[key] = value;
      if (newId) for (const [key, value] of Object.entries(local)) {
        const path = JSON.parse(key);
        if (matches(path)) { path[2] = newId; merged[JSON.stringify(path)] = value; }
      }
      const orderKey = JSON.stringify(['nodeOrder', 'chats', prefix[1]]);
      set(orderKey, cloud[orderKey]);
      if (newId) set(JSON.stringify(['nodeOrder', 'chats', newId]), local[orderKey]);
    }
    if (!newId) return;
    for (const [key, value] of Object.entries(local)) {
      const path = JSON.parse(key) as string[];
      if (!prefix.every((part, i) => path[i] === part)) continue;
      path[prefix.length - 1] = newId;
      const field = path[prefix.length];
      merged[JSON.stringify(path)] = field === 'id' ? JSON.stringify(newId)
        : ['folder', 'parentId'].includes(field) && folders.has(JSON.parse(value)) ? JSON.stringify(folders.get(JSON.parse(value))) : value;
    }
  };
  for (const [id, newId] of folders) copyEntity(['state', 'folders', id], localSnapshot.state.folders?.[id] ? newId : undefined);
  for (const id of chats) copyEntity(['chats', id], localSnapshot.state.chats?.some(chat => chat.id === id) ? crypto.randomUUID() : undefined);
  // Preserved copies can refer to immutable bodies and metadata from either side.
  for (const [key, value] of Object.entries({ ...cloud, ...local })) if (['assets', 'content', 'contentEntries'].includes(JSON.parse(key)[0])) merged[key] = value;
  // Clipboard conflicts retain the local entry, like other settings, as one body/metadata pair.
  for (const [key, value] of Object.entries(merged)) {
    const path = JSON.parse(key);
    if (path[0] !== 'contentEntryRefs' || path[1] !== 'clipboard' || path.length !== 3) continue;
    const bodyKey = JSON.stringify(['state', 'branchClipboard', 'nodes', path[2], 'contentHash']);
    if (merged[bodyKey] !== undefined) {
      const entry = JSON.parse(merged[JSON.stringify(['contentEntries', JSON.parse(value)])]);
      merged[bodyKey] = JSON.stringify(entry.contentId);
    }
  }
  for (const chat of localSnapshot.state.chats ?? []) {
    const remote = cloudSnapshot.state.chats?.find(item => item.id === chat.id);
    if (chats.has(chat.id) || !localEdits.has(chat.id) || !cloudEdits.has(chat.id) || !chat.branchTree || !remote?.branchTree) continue;
    const branchBase = { ...base };
    const rawTree = async (records: Records, tree: BranchTree) => {
      const result = structuredClone(tree);
      for (const node of Object.values(result.nodes)) {
        const bodyKey = JSON.stringify(['chats', chat.id, 'branchTree', 'nodes', node.id, 'contentHash']);
        const refKey = JSON.stringify(contentEntryRefPath(chat.id, node.id));
        const contentId = JSON.parse(records[bodyKey]);
        node.contentHash = JSON.parse(records[refKey]);
        if (base[refKey]) branchBase[bodyKey] = base[refKey];
        else if (await digest(records[bodyKey]) === base[bodyKey]) {
          branchBase[bodyKey] = await digest(JSON.stringify(await contentEntryIdentity(contentId, {})));
        }
      }
      return result;
    };
    const localTree = await rawTree(local, chat.branchTree), cloudTree = await rawTree(cloud, remote.branchTree);
    const { tree, localIds, cloudIds } = await mergeBranches(chat.id, branchBase, localTree, cloudTree);
    // contentHash was temporarily an entry identity, so body and metadata are selected together.
    for (const key of Object.keys(merged)) {
      const path = JSON.parse(key);
      if (path[0] === 'contentEntryRefs' && path[1] === 'chats' && path[2] === chat.id) delete merged[key];
    }
    for (const node of Object.values(tree.nodes)) {
      const entryId = node.contentHash;
      const entry = JSON.parse(merged[JSON.stringify(['contentEntries', entryId])]);
      merged[JSON.stringify(contentEntryRefPath(chat.id, node.id))] = JSON.stringify(entryId);
      node.contentHash = entry.contentId;
    }
    merged[JSON.stringify(['nodeOrder', 'chats', chat.id])] = JSON.stringify(Object.keys(tree.nodes));
    for (const key of Object.keys(merged)) {
      const path = JSON.parse(key);
      if (path[0] === 'chats' && path[1] === chat.id && path[2] === 'branchTree') delete merged[key];
    }
    const put = (path: string[], value: unknown) => { merged[JSON.stringify(['chats', chat.id, ...path])] = JSON.stringify(value); };
    if (tree.messageAttributesV1) {
      put(['branchTree', 'messageAttributesV1', 'version'], 1);
      for (const [id, attributes] of Object.entries(tree.messageAttributesV1.byNode)) put(['branchTree', 'messageAttributesV1', 'byNode', id], attributes);
    }
    put(['branchTree', 'rootId'], tree.rootId); put(['branchTree', 'activePath'], tree.activePath);
    if (!Object.keys(tree.nodes).length) put(['branchTree', 'nodes'], {});
    for (const node of Object.values(tree.nodes)) for (const [field, value] of Object.entries(node)) put(['branchTree', 'nodes', node.id, field], value);
    for (const field of ['collapsedNodes', 'omittedNodes', 'protectedNodes', 'summaryTargets'] as const) {
      for (const [source, ids] of [[remote, cloudIds], [chat, localIds]] as const) {
        for (const id of Object.keys(source[field] ?? {})) {
          const value = merged[JSON.stringify(['chats', chat.id, field, id])];
          if (ids[id] && ids[id] !== id && value !== undefined) put([field, ids[id]], JSON.parse(value));
        }
      }
    }
    const summaryKey = JSON.stringify(['chats', chat.id, 'summaries']);
    const encodedSummaries = merged[summaryKey];
    if (encodedSummaries) {
      const source = encodedSummaries === local[summaryKey] ? chat : remote;
      const ids = source === chat ? localIds : cloudIds;
      try {
        const summaries = JSON.parse(encodedSummaries);
        if (Array.isArray(summaries)) put(['summaries'], summaries.map(summary => ({ ...summary, sources: Array.isArray(summary?.sources) ? summary.sources.map((item: any) => ({ ...item, nodeId: ids[item.nodeId] ?? item.nodeId, parentId: item.parentId === null ? null : (ids[item.parentId] ?? item.parentId) })) : summary?.sources })));
      } catch { /* invalid persisted summaries remain unusable and are rejected at hydration/use */ }
    }
  }
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
