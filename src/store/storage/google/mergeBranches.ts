import type { BranchNode, BranchTree } from '@type/chat';
import { digest } from './crypto';
import type { Records } from './records';

// Parent links remain a tree: equal siblings coalesce, but continuations under
// different parents need separate nodes (their immutable content stays shared).
export async function mergeBranches(chatId: string, base: Records, local: BranchTree, cloud: BranchTree) {
  const prefix = ['chats', chatId, 'branchTree', 'nodes'];
  const baselineFields = new Map<string, Set<string>>();
  for (const key of Object.keys(base)) {
    const path = JSON.parse(key) as string[];
    if (!prefix.every((p, i) => path[i] === p) || path.length !== 6) continue;
    if (!baselineFields.has(path[4])) baselineFields.set(path[4], new Set());
    baselineFields.get(path[4])!.add(path[5]);
  }
  const unchanged = async (node: BranchNode) => {
    const fields = new Set([...Object.keys(node), ...baselineFields.get(node.id) ?? []]);
    for (const field of fields) {
      const value = (node as any)[field];
      if ((value === undefined ? undefined : await digest(JSON.stringify(value))) !== base[JSON.stringify([...prefix, node.id, field])]) return false;
    }
    return true;
  };
  const sides = [structuredClone(cloud), structuredClone(local)];
  const originals = sides.map(tree => structuredClone(tree));
  // A deletion wins only if the other side's entire surviving subtree is unchanged.
  // Otherwise retaining that subtree preserves a concurrent edit/extension.
  for (let side = 0; side < 2; side++) {
    const source = sides[side], other = sides[1 - side];
    const changed = new Set<string>();
    for (const node of Object.values(source.nodes)) if (!await unchanged(node)) {
      let cursor: BranchNode | undefined = node;
      while (cursor && !changed.has(cursor.id)) {
        changed.add(cursor.id); cursor = cursor.parentId ? source.nodes[cursor.parentId] : undefined;
      }
    }
    for (const node of Object.values(source.nodes)) {
      if (!other.nodes[node.id] && !changed.has(node.id)) delete source.nodes[node.id];
    }
  }
  for (const id of Object.keys(sides[0].nodes)) {
    const right = sides[0].nodes[id], left = sides[1].nodes[id];
    if (!left) continue;
    for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (field === 'id') continue;
      const l = (left as any)[field], r = (right as any)[field];
      if (l === r) continue;
      const baseline = base[JSON.stringify([...prefix, id, field])];
      const lh = l === undefined ? undefined : await digest(JSON.stringify(l));
      const rh = r === undefined ? undefined : await digest(JSON.stringify(r));
      if (lh === baseline || rh === baseline) {
        const value = lh === baseline ? r : l;
        for (const node of [left, right]) {
          if (value === undefined) delete (node as any)[field]; else (node as any)[field] = value;
        }
      }
    }
  }
  // Independently valid reparenting edits can form a cycle when combined.
  const coherent = (tree: BranchTree) => {
    const checked = new Set<string>();
    for (const node of Object.values(tree.nodes)) {
      const seen = new Set<string>();
      let cursor: BranchNode | undefined = node;
      while (cursor && !checked.has(cursor.id)) {
        if (seen.has(cursor.id)) return false;
        seen.add(cursor.id);
        if (cursor.parentId && !tree.nodes[cursor.parentId]) return false;
        cursor = cursor.parentId ? tree.nodes[cursor.parentId] : undefined;
      }
      for (const id of seen) checked.add(id);
    }
    return true;
  };
  const inputs = sides.every(coherent) ? sides : originals;
  const nodes: BranchTree['nodes'] = {};
  const maps: Record<string, string>[] = [{}, {}];
  const signatures = new Map<string, string[]>();
  for (let side = 0; side < 2; side++) {
    const tree = inputs[side], used = new Set<string>();
    const append = (id: string) => {
      const chain: BranchNode[] = [];
      let cursor: BranchNode | undefined = tree.nodes[id];
      while (cursor && !maps[side][cursor.id]) {
        chain.push(cursor); cursor = cursor.parentId ? tree.nodes[cursor.parentId] : undefined;
      }
      for (const node of chain.reverse()) {
        const parentId = node.parentId ? maps[side][node.parentId] : null;
        const signature = JSON.stringify([parentId, node.role, node.contentHash, node.label ?? null, !!node.starred, !!node.pinned]);
        const candidates = side === 1 ? signatures.get(signature)?.filter(candidate => !used.has(candidate)) : undefined;
        const match = candidates?.includes(node.id) ? node.id : candidates?.[0];
        const target = match ?? (nodes[node.id] ? crypto.randomUUID() : node.id);
        if (!match) {
          nodes[target] = { ...node, id: target, parentId };
          signatures.set(signature, [...signatures.get(signature) ?? [], target]);
        }
        used.add(target); maps[side][node.id] = target;
      }
    };
    for (const id of Object.keys(tree.nodes)) append(id);
  }
  const activePath: string[] = [];
  let tip: string | null = local.activePath.map(id => maps[1][id]).filter(Boolean).at(-1) ?? null;
  while (tip) { activePath.unshift(tip); tip = nodes[tip].parentId; }
  const tree: BranchTree = { nodes, activePath, rootId: activePath[0] ?? maps[0][cloud.rootId] ?? Object.keys(nodes)[0] ?? '' };
  return { tree, cloudIds: maps[0], localIds: maps[1] };
}
