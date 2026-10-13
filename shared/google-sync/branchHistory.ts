import { generationPlan } from './generationPlan';
import { captureBranchHistory, invalidateBranchHistory, changedBranchChatIds, canStepBranchHistory, stepBranchHistory, type BranchHistory, type BranchHistoryState } from '../../src/utils/branchHistory';
import { diffJSONChanges, orderedJSONEqual } from '../../src/utils/jsonChanges';
import { materializeActivePath } from '../../src/utils/branchUtils';
import { messageEdit } from './editing';
import { nodeRemoval } from './nodeRemoval';
import { nodeOptions } from './nodeOptions';
import { treeEdit } from './treeEdit';
import { branchClipboard } from './branchClipboard';

export function branchHistory(json: string): string {
  const input = JSON.parse(json);
  let history: BranchHistory = input.history ?? {past:[],future:[]};
  const busy: string[] = input.busyChatIds ?? [];
  let output: Record<string, unknown> = {};
  if (input.operation === 'edit') {
    const bridges = {messageEdit,nodeRemoval,nodeOptions,treeEdit,branchClipboard,generationPlan};
    const bridge = bridges[input.kind as keyof typeof bridges];
    if (!bridge) throw new Error('Invalid history edit.');
    const result = JSON.parse(bridge(JSON.stringify(input.input), (before, after) => {
      history = captureBranchHistory(history, before, after);
    }));
    output = input.kind === 'nodeOptions' || input.kind === 'treeEdit' || input.kind === 'branchClipboard' || input.kind === 'generationPlan' || (input.kind === 'messageEdit' && input.input.operation === 'insertGenerate') ? result : {changes:result};
    if(input.kind==='generationPlan'&&input.input.operation==='prepare'&&result.status==='updated')history=invalidateBranchHistory(history,[input.input.chat.id]);
  } else if (input.operation === 'undo' || input.operation === 'redo') {
    const before: BranchHistoryState = {chats:input.chats, contentStore:input.contentStore};
    const result = stepBranchHistory(history, before, input.operation, busy);
    history = result.history;
    if (result.status === 'updated') {
      // External redundant messages include attributes; history rules restore
      // the runtime projection, so project them at this I/O boundary only.
      result.state.chats = result.state.chats.map(chat => result.affectedChatIds.includes(chat.id) && chat.branchTree ? {...chat,messages:materializeActivePath(chat.branchTree,result.state.contentStore,true)} : chat);
    }
    output = {status:result.status, affectedChatIds:result.affectedChatIds,
      changes:result.status === 'updated' ? diffJSONChanges(before, JSON.parse(JSON.stringify(result.state))) : []};
  } else if (input.operation === 'invalidate') {
    const ids = input.chatIds ?? changedBranchChatIds(input.before,input.after,
      (a,b) => orderedJSONEqual(a.messages,b.messages) && orderedJSONEqual(a.branchTree,b.branchTree));
    history = invalidateBranchHistory(history, ids);
  } else if (input.operation !== 'can' && input.operation !== 'initialize') throw new Error('Invalid history operation.');
  return JSON.stringify({...output, history, can:{undo:canStepBranchHistory(history,'undo',busy), redo:canStepBranchHistory(history,'redo',busy)}});
}
