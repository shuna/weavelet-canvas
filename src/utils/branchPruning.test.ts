import {expect,it} from 'vitest';
import type {BranchTree} from '../types/chat';
import {hasHiddenBranchNodes} from './branchPruning';
import {branchLayout} from '../../shared/google-sync/branchLayout';

const tree: BranchTree = {rootId:'root',activePath:['root'],nodes:{
  root:{id:'root',parentId:null,role:'user',contentHash:'body',createdAt:1},
  hidden:{id:'hidden',parentId:'root',role:'assistant',contentHash:'body',createdAt:2,pinned:true},
}};

it('keeps the Web hidden-node check, including pinned nodes and exact Unicode keys', () => {
  expect(hasHiddenBranchNodes(tree)).toBe(true);
  expect(hasHiddenBranchNodes({...tree,activePath:['root','hidden']})).toBe(false);
  expect(hasHiddenBranchNodes({rootId:'',nodes:{},activePath:[]})).toBe(false);
  expect(hasHiddenBranchNodes({...tree,activePath:['root','hiddén'],nodes:{
    root:tree.nodes.root,'hidde\u0301n':{...tree.nodes.hidden,id:'hidde\u0301n'},
  }})).toBe(true);
});

it('passes only hidden-tree targets to native in entry order without normalizing IDs or mutating input', () => {
  const input = {operation:'pruneTargets',entries:[
    {chatId:'é',tree},{chatId:'visible',tree:{...tree,activePath:['root','hidden']}},
    {chatId:'e\u0301',tree},
  ]};
  const before = structuredClone(input);
  expect(JSON.parse(branchLayout(JSON.stringify(input)))).toEqual(['é','e\u0301']);
  expect(input).toEqual(before);
});
