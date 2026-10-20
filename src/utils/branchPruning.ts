import type {BranchTree} from '../types/chat';

export function hasHiddenBranchNodes(tree: BranchTree): boolean {
  const active = new Set(tree.activePath);
  return Object.keys(tree.nodes).some(id => !active.has(id));
}
