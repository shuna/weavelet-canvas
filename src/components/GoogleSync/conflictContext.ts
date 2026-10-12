import type { Snapshot } from '@store/storage/google/records';
import { resolveContent } from '@utils/contentStore';

export function parseConflictPath(key: string): string[] {
  try {
    const path = JSON.parse(key);
    return Array.isArray(path) && path.every(part => typeof part === 'string') ? path : [];
  } catch { return []; }
}

export function getConflictContext(snapshot: Snapshot, key: string) {
  const path = parseConflictPath(key);
  const chat = path[0] === 'chats' ? snapshot.state.chats?.find(chat => chat.id === path[1]) : undefined;
  const nodeId = path[2] === 'branchTree' && path[3] === 'nodes' ? path[4] : undefined;
  const tree = chat?.branchTree;
  const branches: { id: string; label?: string; nodeIds: string[] }[] = [];
  if (tree) {
    const parents = new Set(Object.values(tree.nodes).map(node => node.parentId));
    for (const leaf of Object.values(tree.nodes)) {
      if (parents.has(leaf.id)) continue;
      const nodeIds: string[] = [];
      const visited = new Set<string>();
      let node = leaf;
      while (node && !visited.has(node.id)) {
        visited.add(node.id);
        nodeIds.unshift(node.id);
        if (!node.parentId) break;
        node = tree.nodes[node.parentId];
      }
      if (!node || node.parentId) continue;
      if (nodeId && tree.nodes[nodeId] && !nodeIds.includes(nodeId)) continue;
      branches.push({ id: leaf.id, label: leaf.label, nodeIds });
    }
  }
  const activeTip = tree?.activePath.at(-1);
  const preferredBranch = branches.find(branch => activeTip && branch.nodeIds.includes(activeTip)) ?? branches[0];
  let value: unknown = path[0] === 'chats' ? chat : path[0] === 'state' ? snapshot.state : undefined;
  const fields = path.slice(path[0] === 'chats' ? 2 : 1);
  for (const field of fields) value = value && typeof value === 'object' && Object.hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined;
  return { path, chat, nodeId, branches, preferredBranch, value };
}

export function getBranchMessages(snapshot: Snapshot, key: string, branchId?: string) {
  const context = getConflictContext(snapshot, key);
  if (!context.chat) return [];
  if (!context.chat.branchTree) return (context.chat.messages ?? []).map((message, index) => ({
    ...message, id: String(index), position: index + 1, target: false,
  }));
  const branch = context.branches.find(branch => branch.id === branchId) ?? context.preferredBranch;
  return (branch?.nodeIds ?? []).map((id, index) => {
    const node = context.chat!.branchTree!.nodes[id];
    return { id, position: index + 1, role: node.role, target: id === context.nodeId,
      content: resolveContent(snapshot.state.contentStore ?? {}, node.contentHash) };
  });
}

// Keep the full path visible for settings that do not yet have a translated label.
export function describeSettingPath(path: string[], label: (field: string) => string) {
  return path.slice(1).map(label).join(' › ');
}

export function formatSettingValue(path: string[], value: unknown, label: (key: string) => string, locale: string) {
  const field = path.at(-1);
  const verification = ['pendingVerifications', 'verifiedStats'].includes(path[1]);
  if (verification && field === 'nextAttemptAt' && value === Number.MAX_SAFE_INTEGER) return label('noAutoRetry');
  if (verification && field === 'status' && ['pending', 'fetching', 'failed'].includes(String(value))) return label(String(value));
  if (verification && ['requestedAt', 'nextAttemptAt', 'lastAttemptAt', 'fetchedAt'].includes(field ?? '') && typeof value === 'number' && Number.isFinite(new Date(value).getTime())) return new Date(value).toLocaleString(locale);
  if (typeof value === 'boolean') return label(value ? 'enabled' : 'disabled');
  if (value === null) return label('unset');
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
