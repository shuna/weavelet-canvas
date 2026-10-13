import type {BranchTree} from '@type/chat';
import {isTextContent} from '@type/chat';
import type {ContentStoreData} from './contentStore';
import {resolveContent} from './contentStore';
import {wordDiff, type DiffSegment} from './diffUtils';

export type BranchDiffInput = {tree: BranchTree; contentStore: ContentStoreData; pathA: string[]; pathB: string[]};
export type BranchDiffRow = {role: string; segments: DiffSegment[]; textA: string; textB: string};

export function branchDiff({tree, contentStore, pathA, pathB}: BranchDiffInput): {rows: BranchDiffRow[]; hasChanges: boolean} {
  const maxLen = Math.max(pathA.length, pathB.length);
  const rows: BranchDiffRow[] = [];

  for (let i = 0; i < maxLen; i++) {
    const nodeA = pathA[i] ? tree.nodes[pathA[i]] : null;
    const nodeB = pathB[i] ? tree.nodes[pathB[i]] : null;

    const contentA = nodeA ? resolveContent(contentStore, nodeA.contentHash) : [];
    const contentB = nodeB ? resolveContent(contentStore, nodeB.contentHash) : [];

    const textA = contentA.filter(isTextContent).map((c) => c.text).join(' ');
    const textB = contentB.filter(isTextContent).map((c) => c.text).join(' ');

    const role = nodeA?.role || nodeB?.role || 'unknown';
    const segments = wordDiff(textA, textB);

    rows.push({role, segments, textA, textB});
  }
  return {rows, hasChanges: rows.some((r) => r.segments.some((s) => s.type !== 'equal'))};
}
