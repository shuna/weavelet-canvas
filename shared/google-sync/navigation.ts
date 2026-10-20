import { getSiblingGroups, resolveBranchSwipeDirection } from '../../src/utils/branchUtils';
import { switchActivePathState } from '../../src/store/branch-domain';
import { diffJSONChanges } from '../../src/utils/jsonChanges';
import { resolveNavigationTarget, navigationEntry, viewSwitchNavigationEntry, entryWithNavigationKey, navigationEntryWithAnchor, captureNavigationHistory, restoredNavigationPath, emptyNavigationHistory, initializeNavigationHistory, pushNavigationHistory, moveNavigationHistory, canMoveNavigationHistory } from '../../src/utils/branchNavigation';

const decodeHistory = (value:any) => ({...value,navEntryMap:new Map(value.navEntryMap)});
const encodeHistory = (value:any) => ({...value,navEntryMap:[...value.navEntryMap.entries()]});
export function navigationOperation(json: string): string {
  const input = JSON.parse(json), source = input.source;
  switch (input.operation) {
    case 'swipeDirection': return JSON.stringify(resolveBranchSwipeDirection(input.distance, input.preference));
    case 'navigate': {
      let target = resolveNavigationTarget(source.chats,input.chatId,input.nodeId,input.navigationSource);
      if (target.status !== 'reached') return JSON.stringify({...target,changes:[]});
      let chats = source.chats;
      if (input.viewingPath && chats[target.chatIndex].branchTree)
        chats = switchActivePathState(chats,target.chatIndex,input.viewingPath,source.contentStore);
      target = resolveNavigationTarget(chats,input.chatId,input.nodeId,input.navigationSource);
      if (target.status !== 'reached') return JSON.stringify({...target,changes:[]});
      if (chats[target.chatIndex].branchTree)
        chats = switchActivePathState(chats,target.chatIndex,target.path,source.contentStore);
      // Web clones may add undefined optional maps; omit them at the JSON boundary before diffing.
      return JSON.stringify({...target,changes:diffJSONChanges(source,JSON.parse(JSON.stringify({...source,chats})))});
    }
    case 'restore': {
      const chatIndex = source.chats.findIndex((chat:any)=>chat.id === input.entry.chatId), chat = source.chats[chatIndex];
      if (!chat) return JSON.stringify({status:'chat-missing',changes:[]});
      const path = restoredNavigationPath(chat,input.entry.activePath);
      const chats = path ? switchActivePathState(source.chats,chatIndex,path,source.contentStore) : source.chats;
      return JSON.stringify({status:'reached',chatId:chat.id,chatIndex,path:path ?? [...(chat.branchTree?.activePath ?? [])],focusedNodeId:input.entry.focusedNodeId,changes:diffJSONChanges(source,JSON.parse(JSON.stringify({...source,chats})))});
    }
    case 'candidates': return JSON.stringify(source.chats.map((chat:any) => {
      const grouped = chat.branchTree ? getSiblingGroups(chat.branchTree) : {groups:[],byNode:{}};
      return {chatId:chat.id,activePath:[...(chat.branchTree?.activePath ?? [])],nodeIDs:Object.keys(chat.branchTree?.nodes ?? {}),
        groups:grouped.groups.map(group=>group.map(node=>node.id)),byNode:grouped.byNode};
    }));
    case 'historyEmpty': return JSON.stringify(encodeHistory(emptyNavigationHistory()));
    case 'history': {
      const history = decodeHistory(input.history);
      let next = history;
      if (input.action === 'initialize') {
        const chat = source.chats.find((chat:any)=>chat.id===input.chatId);
        const displayed = chat?.branchTree && input.viewingPath ? {...chat,branchTree:{...chat.branchTree,activePath:input.viewingPath}} : chat;
        next = initializeNavigationHistory(history,displayed,input.key,input.view);
      }
      else if (input.action === 'push') {
        const partial = input.target ? navigationEntry(input.target,input.view,input.navigationSource) : input.entry;
        next = pushNavigationHistory(history,entryWithNavigationKey(partial,input.key));
      } else if (input.action === 'viewSwitch') {
        const chat = source.chats.find((chat:any) => chat.id === input.chatId);
        const partial = viewSwitchNavigationEntry(history.navHistoryCurrent,chat,input.view);
        if (partial) next = pushNavigationHistory(history,entryWithNavigationKey(partial,input.key));
      } else if (input.action === 'capture') {
        next = captureNavigationHistory(history,history.navHistoryCurrent && navigationEntryWithAnchor(history.navHistoryCurrent,input.scrollAnchor));
      }
      else next = moveNavigationHistory(history,source.chats,input.action) ?? history;
      return JSON.stringify({history:encodeHistory(next),entry:next.navHistoryCurrent,canBack:canMoveNavigationHistory(next,source.chats,'back'),canForward:canMoveNavigationHistory(next,source.chats,'forward')});
    }
    default: throw new Error('Unknown navigation operation');
  }
}
