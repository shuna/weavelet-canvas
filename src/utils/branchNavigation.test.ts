import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { navigationOperation } from '../../shared/google-sync/navigation';
import { recordChatEdits } from '@store/chat-edit-time';
import { resolveNavigationTarget, restoredNavigationPath, emptyNavigationHistory, pushNavigationHistory, moveNavigationHistory, viewSwitchNavigationEntry } from './branchNavigation';
import { diffJSONChanges } from './jsonChanges';
const fixture = () => JSON.parse(readFileSync(new URL('../../tests/fixtures/web-native/io-corpus.json',import.meta.url),'utf8')).exportV3;
const call = (input:any) => JSON.parse(navigationOperation(JSON.stringify(input)));
const entry = (chatId:string,key:string) => ({chatId,key,activePath:[],source:'chat-switch' as const});
describe('shared branch navigation',()=>{
  it('omits undefined optional maps before producing native navigation and restore patches',()=>{
    const source=fixture();
    for(const key of ['collapsedNodes','omittedNodes','protectedNodes']) delete source.chats[0][key];
    const before=structuredClone(source);
    for(const input of [
      {operation:'navigate',chatId:'chat-a',nodeId:'n-inactive',navigationSource:'search'},
      {operation:'restore',entry:{chatId:'chat-a',activePath:['n-system','n-user','n-inactive']}},
    ]) {
      const result=call({...input,source});
      expect(result.path).toEqual(['n-system','n-user','n-inactive']);
      expect(result.changes.filter((patch:any)=>patch.op==='set').every((patch:any)=>Object.hasOwn(patch,'value'))).toBe(true);
      expect(result.changes.some((patch:any)=>['collapsedNodes','omittedNodes','protectedNodes'].includes(patch.path.at(-1)))).toBe(false);
    }
    expect(source).toEqual(before);
  });
  it('uses current Web target and newest descendant rules while preserving search/grep continuation',()=>{
    const source=fixture();
    expect(resolveNavigationTarget(source.chats,'chat-a','n-user','branch-switch').path).toEqual(['n-system','n-user','n-inactive']);
    expect(resolveNavigationTarget(source.chats,'chat-a','n-user','search').path).toEqual(['n-system','n-user','n-assistant']);
    expect(resolveNavigationTarget(source.chats,'chat-a','n-user','grep').path).toEqual(['n-system','n-user','n-assistant']);
    expect(resolveNavigationTarget(source.chats,'chat-b','message-0').status).toBe('node-missing');
    expect(resolveNavigationTarget(source.chats,'absent').status).toBe('chat-missing');
  });
  it('uses legacy displayed path before search resolution and only changes activePath/messages',()=>{
    const source=fixture();
    const result=call({operation:'navigate',source,chatId:'chat-a',nodeId:'n-user',navigationSource:'search',viewingPath:['n-system','n-user','n-inactive']});
    expect(result.path).toEqual(['n-system','n-user','n-inactive']);
    expect(result.changes.some((patch:any)=>patch.path.includes('contentStore')||patch.path.includes('updatedAt'))).toBe(false);
    const expected=structuredClone(source.chats);
    expected[0].branchTree.activePath=result.path;
    expect(recordChatEdits(source.chats,expected,1700000000123).changed).toBe(false);
    expect(diffJSONChanges(source,source)).toEqual([]);
  });
  it('returns all-node sibling candidates in actual Web insertion order including roots and Unicode identities',()=>{
    const source=fixture();
    const candidates=call({operation:'candidates',source});
    expect(candidates[0].groups[candidates[0].byNode['n-assistant'].groupIndex]).toEqual(['n-inactive','n-assistant']);
    expect(candidates[0].byNode['n-assistant'].selectedIndex).toBe(1);
    expect(candidates[0].groups[candidates[0].byNode['n-system'].groupIndex]).toEqual(['n-system']);
    expect(candidates[0].byNode['n-system'].selectedIndex).toBe(0);
    expect(candidates[1].nodeIDs).toEqual([]);
    const nodes:any={};
    for(const id of ['é','e\u0301']) nodes[id]={id,parentId:null,role:'user',createdAt:1,contentHash:'x'};
    const unicode=call({operation:'candidates',source:{chats:[{id:'unicode',branchTree:{nodes,activePath:['é']}}]}});
    expect(unicode[0].byNode['e\u0301'].selectedIndex).toBe(1);
  });
  it('returns one sibling group for 1000 nodes with linear member count and payload size',()=>{
    const nodes=Object.fromEntries(Array.from({length:1000},(_,index)=>{const id=`node-${index}`;return [id,{id,parentId:null,createdAt:index}];}));
    const json=navigationOperation(JSON.stringify({operation:'candidates',source:{chats:[{id:'large',branchTree:{nodes,activePath:['node-0']}}]}}));
    const chat=JSON.parse(json)[0];
    expect(chat.groups).toHaveLength(1);
    expect(chat.groups.reduce((count:number,group:string[])=>count+group.length,0)).toBe(1000);
    expect(Object.keys(chat.byNode)).toHaveLength(1000);
    expect(chat.byNode['node-999']).toEqual({groupIndex:0,selectedIndex:999});
    expect(Buffer.byteLength(json,'utf8')).toBeLessThan(100000);
  });
  it('shares history limit/map retention, deleted-chat skipping and forward invalidation',()=>{
    let history=emptyNavigationHistory();
    for(let i=0;i<103;i++) history=pushNavigationHistory(history,entry('chat-a',String(i)));
    expect(history.navHistoryPast).toHaveLength(100); expect(history.navEntryMap.size).toBe(103);
    history=pushNavigationHistory(history,entry('deleted','deleted'));
    history=pushNavigationHistory(history,entry('chat-b','last'));
    const back=moveNavigationHistory(history,[{id:'chat-a'},{id:'chat-b'}],'back')!;
    expect(back.navHistoryCurrent!.key).toBe('102');
    expect(back.navHistoryFuture.map(e=>e.key)).toEqual(['deleted','last']);
    const forward=moveNavigationHistory(back,[{id:'chat-a'},{id:'chat-b'}],'forward')!;
    expect(forward.navHistoryCurrent!.key).toBe('last');
    expect(pushNavigationHistory(back,entry('chat-a','new')).navHistoryFuture).toEqual([]);
    expect(call({operation:'historyEmpty'}).navEntryMap).toEqual([]);
  });
  it('creates history entries from reached targets and captures only the current anchor through the shared route',()=>{
    const source=fixture();
    const initialized=call({operation:'history',action:'initialize',source,history:call({operation:'historyEmpty'}),chatId:'chat-a',key:'init',view:'chat',viewingPath:['n-system','n-user','n-inactive']});
    expect(initialized.entry.activePath).toEqual(['n-system','n-user','n-inactive']);
    const anchor={firstVisibleItemIndex:1,offsetWithinItem:7,wasAtBottom:false,nodeId:'n-user'};
    const captured=call({operation:'history',action:'capture',source,history:initialized.history,scrollAnchor:anchor});
    expect(captured.entry.scrollAnchor).toEqual(anchor);
    const target=call({operation:'navigate',source,chatId:'chat-a',nodeId:'n-assistant',navigationSource:'branch-switch'});
    const pushed=call({operation:'history',action:'push',source,history:captured.history,target,key:'next',view:'chat',navigationSource:'branch-switch'});
    expect(pushed.entry).toMatchObject({key:'next',chatId:'chat-a',activePath:target.path,focusedNodeId:'n-assistant',source:'branch-switch'});
    expect(pushed.history.navHistoryPast[0].scrollAnchor).toEqual(anchor);
  });
  it('builds view-switch entries from the raw active path and skips the current chat/view',()=>{
    const source=fixture(), chat=source.chats[0];
    chat.branchTree.activePath=['n-system','n-user','n-inactive'];
    expect(viewSwitchNavigationEntry({chatId:'chat-a',viewContext:'branch-editor'},chat,'branch-editor')).toBeUndefined();
    expect(viewSwitchNavigationEntry(null,chat,'branch-editor')).toMatchObject({chatId:'chat-a',activePath:['n-system','n-user','n-inactive'],viewContext:'branch-editor',source:'view-switch'});
    const initialized=call({operation:'history',action:'initialize',source,history:call({operation:'historyEmpty'}),chatId:'chat-a',key:'init',view:'chat',viewingPath:['n-system','n-user','n-assistant']});
    const switched=call({operation:'history',action:'viewSwitch',source,history:initialized.history,chatId:'chat-a',key:'switch',view:'branch-editor'});
    expect(switched.entry).toMatchObject({key:'switch',activePath:['n-system','n-user','n-inactive'],source:'view-switch'});
    const duplicate=call({operation:'history',action:'viewSwitch',source,history:switched.history,chatId:'chat-a',key:'duplicate',view:'branch-editor'});
    expect(duplicate.history).toEqual(switched.history);
  });
  it('restores only a valid saved parent path, keeps the current path for invalid or empty paths',()=>{
    const source=fixture(), chat=source.chats[0];
    expect(restoredNavigationPath(chat,['n-system','n-user','n-inactive'])).toEqual(['n-system','n-user','n-inactive']);
    expect(restoredNavigationPath(chat,['n-user','n-system'])).toBeUndefined();
    expect(restoredNavigationPath(chat,[])).toBeUndefined();
    const invalid=call({operation:'restore',source,entry:{chatId:'chat-a',activePath:['n-user','n-system']}});
    expect(invalid.path).toEqual(chat.branchTree.activePath); expect(invalid.changes).toEqual([]);
  });
});
