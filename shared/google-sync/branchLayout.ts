import {layoutBranchEntries, type WorkerInput} from '../../src/utils/branchLayout';
import {contentPreview} from '../../src/utils/contentPreview';
import {resolveBranchSelection, type BranchSelectionNode} from '../../src/utils/branchSelection';
import {ensureBranchTreeState} from '../../src/store/branch-domain';
import {diffJSONChanges} from '../../src/utils/jsonChanges';
import type {ChatInterface} from '../../src/types/chat';
import type {ContentStoreData} from '../../src/utils/contentStore';
import {withEditingRuntime} from './editing';
import {branchDiff as buildBranchDiff, type BranchDiffInput} from '../../src/utils/branchDiff';
import {buildPathToLeaf, buildNodeDiffPaths} from '../../src/utils/branchUtils';
import type {BranchTree} from '../../src/types/chat';

// The Web preview can end halfway through a UTF-16 pair after its 80-unit slice.
const nativePreview = (value: string) => Array.from(value, scalar =>
  scalar.length === 1 && scalar.charCodeAt(0) >= 0xd800 && scalar.charCodeAt(0) <= 0xdfff ? '\ufffd' : scalar).join('');

export function branchLayout(json: string): string {
  const input = JSON.parse(json) as WorkerInput | {operation?: string; content?: Array<{type:string;text?:string}>; selectedNodes?: BranchSelectionNode[]};
  if ('operation' in input && input.operation === 'preview') {
    return JSON.stringify({preview:nativePreview(contentPreview(input.content ?? []))});
  }
  if ('operation' in input && input.operation === 'selection') {
    return JSON.stringify(resolveBranchSelection(input.selectedNodes ?? []));
  }
  const output = layoutBranchEntries(input as WorkerInput);
  for (const node of output.rfNodes) node.data.contentPreview = nativePreview(node.data.contentPreview);
  return JSON.stringify(output);
}

export function branchDiff(json: string): string {
  return JSON.stringify(buildBranchDiff(JSON.parse(json) as BranchDiffInput));
}

export function branchPath(json: string): string {
  const {tree, nodeId} = JSON.parse(json) as {tree: BranchTree; nodeId: string};
  if (!tree.nodes[nodeId]) throw new Error('node-missing');
  return JSON.stringify(buildPathToLeaf(tree, nodeId));
}

export function branchNodeDiffPaths(json: string): string {
  const {tree, nodeIdA, nodeIdB} = JSON.parse(json) as {tree: BranchTree; nodeIdA: string; nodeIdB: string};
  if (!tree.nodes[nodeIdA] || !tree.nodes[nodeIdB]) throw new Error('node-missing');
  return JSON.stringify(buildNodeDiffPaths(tree, nodeIdA, nodeIdB));
}

export function branchEnsure(json: string): string {
  const input: {chat: ChatInterface; contentStore: ContentStoreData; newIDs: string[]; now: number} = JSON.parse(json);
  const before = {chat: input.chat, contentStore: input.contentStore};
  if (input.chat.branchTree) return JSON.stringify([]);
  const isolated = structuredClone(before);
  return withEditingRuntime(input.newIDs, [], input.now, () => {
    const result = ensureBranchTreeState([isolated.chat], 0, isolated.contentStore);
    return JSON.stringify(diffJSONChanges(before, JSON.parse(JSON.stringify({chat: result.chats[0], contentStore: result.contentStore}))));
  });
}
