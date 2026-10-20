import {expect,it} from 'vitest';
import {resolveBranchSelection} from './branchSelection';
import {branchLayout} from '../../shared/google-sync/branchLayout';

it('uses graph order for the range and the last node for paste without changing the selection', () => {
  const selectedNodes = [{chatId:'chat',nodeId:'root'},{chatId:'chat',nodeId:'leaf'}];
  const before = structuredClone(selectedNodes);
  const result = resolveBranchSelection(selectedNodes);
  expect(result).toEqual({range:{chatId:'chat',fromNodeId:'root',toNodeId:'leaf'},pasteTarget:{chatId:'chat',afterNodeId:'leaf'}});
  expect(JSON.parse(branchLayout(JSON.stringify({operation:'selection',selectedNodes})))).toEqual(result);
  expect(selectedNodes).toEqual(before);
  expect(resolveBranchSelection([selectedNodes[0]]).range).toEqual({chatId:'chat',fromNodeId:'root',toNodeId:'root'});
  expect(resolveBranchSelection([])).toEqual({range:null,pasteTarget:null});
});

it('never combines another conversation or Unicode-equivalent ID into a range', () => {
  const selectedNodes = [{chatId:'chat-é',nodeId:'same'},{chatId:'chat-e\u0301',nodeId:'same'}];
  expect(resolveBranchSelection(selectedNodes)).toEqual({range:null,pasteTarget:{chatId:'chat-e\u0301',afterNodeId:'same'}});
});
