import actualIOSState from '../../tests/fixtures/web-native/legacy-ios-app-state.json';
import actualIOSSnapshot from '../../tests/fixtures/web-native/legacy-ios-sync-snapshot.json';
import legacyIOSState from './__fixtures__/legacy-ios-state.json';
import {normalizeLegacyIOSImport} from './legacyIOSImport';
import {describe,expect,it,vi,afterEach} from 'vitest';
vi.mock('uuid',()=>({v4:()=>editingUUID()}));
import {editingUUID} from '../../shared/google-sync/editing';
import {fileImport} from '../../shared/google-sync/fileImport';
import {resolveContent} from './contentStore';
import * as importUtils from './import';
import {_defaultChatConfig} from '../constants/chatDefaults';
const call=(input:any)=>JSON.parse(fileImport(JSON.stringify(input)));
const ids=()=>Array.from({length:50},(_,i)=>`new-${i}`);
const chat=(id='old')=>({id,title:'Imported',config:{..._defaultChatConfig},titleSet:true,imageDetail:'auto',messages:[{role:'user',content:[{type:'text',text:'Hello',xPart:{opaqueRef:5}}],xMessage:{opaqueRef:6}}],xChat:{opaqueRef:7}});
const v3=()=>({version:3,chats:[chat()],folders:{},contentStore:{},evaluationResults:{},xRoot:{opaqueRef:8}});
const prepare=(data:any,extra:any={})=>call({operation:'prepare',data,newIDs:ids(),now:10,...extra});
function apply(source:any,changes:any[]){const root=JSON.parse(JSON.stringify(source));for(const c of changes){let parent=root;for(const k of c.path.slice(0,-1))parent=parent[k];const key=c.path.at(-1);if(c.op==='set')parent[key]=c.value;else if(c.op==='remove'){if(Array.isArray(parent))parent.splice(key,1);else delete parent[key];}else{const object=c.path.length?parent[key]:root,entries=c.keys.map((key:string)=>[key,object[key]]);Object.keys(object).forEach(key=>delete object[key]);Object.assign(object,Object.fromEntries(entries));}}return root;}
afterEach(()=>vi.restoreAllMocks());
describe('shared file import core',()=>{
 it.each(['LegacyImport','SingleChat','ExportV1','ExportV2','ExportV3'])('prepares %s via actual converters without mutating input',type=>{
  const data:any=type==='LegacyImport'?[chat()]:type==='SingleChat'?chat():{...v3(),version:type==='ExportV1'?1:type==='ExportV2'?2:3};// A real Web V1 has inline bodies, without the iOS hashed content-store root.
  if(type==='ExportV1')delete data.contentStore;const before=structuredClone(data),result=prepare(data);
  expect(result.status).toBe('ready');expect(result.type).toBe(type);expect(result.source.chats).toHaveLength(1);expect(result.source.chats[0].branchTree.activePath).toHaveLength(1);expect(result.previewV3.chats[0].xChat).toEqual({opaqueRef:7});expect(result.previewV3.chats[0].branchTree.messageAttributesV1.byNode[result.source.chats[0].branchTree.rootId]).toEqual({xMessage:{opaqueRef:6}});expect(result.source.contentStore[result.source.chats[0].branchTree.nodes[result.source.chats[0].branchTree.rootId].contentHash].content).toEqual(chat().messages[0].content);expect(data).toEqual(before);
 });
 it('prepares inline V2 branch data and old remote backup without parallel format conversion',()=>{
  const data:any={version:2,chats:[{...chat(),branchTree:{rootId:'node',activePath:['node'],nodes:{node:{id:'node',parentId:null,role:'user',content:chat().messages[0].content,createdAt:1,xNode:{opaqueRef:9}}}}}],folders:{}};
  const result=prepare(data);expect(result.status).toBe('ready');expect(result.source.chats[0].branchTree.nodes.node.xNode).toEqual({opaqueRef:9});expect(result.source.chats[0].branchTree.nodes.node).not.toHaveProperty('content');expect(resolveContent(result.source.contentStore,result.source.chats[0].branchTree.nodes.node.contentHash)).toEqual(chat().messages[0].content);
  expect(prepare({version:12,state:{chats:[chat()],folders:{}}}).status).toBe('ready');expect(()=>prepare({version:99,state:{chats:[chat()],folders:{}}})).toThrow('版');
 });
 it('plans append with ancestor folders, colliding hashes and ID remapping while preserving unrelated base roots',()=>{
  const source=prepare(v3()).source,base:any={chats:[{...chat('existing'),title:'Existing'}],folders:{},contentStore:{},evaluationResults:{},xExisting:{opaqueRef:10},setChats:{opaqueRef:11}};
  const hash=source.chats[0].branchTree.nodes[source.chats[0].branchTree.rootId].contentHash;base.contentStore[hash]={content:[{type:'text',text:'Existing colliding body'}],refCount:1};const oldEntry=structuredClone(base.contentStore[hash]);
  const result=call({operation:'plan',mode:'append',base,source,newIDs:ids().map(id=>`append-${id}`),now:20,fileName:'fake.json',baseExtensions:{old:{opaqueRef:12}},currentChatId:'existing'}),output=apply(base,result.changes);
  expect(output.contentStore[hash]).toEqual(oldEntry);expect(output.chats[0].branchTree.nodes[source.chats[0].branchTree.rootId].contentHash).toBe(hash+'_');expect(resolveContent(output.contentStore,hash+'_')).toEqual(chat().messages[0].content);
  expect(result.result.success).toBe(true);expect(result.currentChatIndex).toBe(1);expect(output.chats[0].folder).toBe('append-new-0');expect(output.chats[1]).toEqual(base.chats[0]);expect(output.setChats).toEqual({opaqueRef:11});expect(output.xExisting).toEqual({opaqueRef:10});expect(Object.keys(output.folders)).toEqual(['append-new-0']);expect(apply({old:{opaqueRef:12}},result.extensionChanges)).toEqual({old:{opaqueRef:12},xRoot:{opaqueRef:8}});
 });
 it('plans full replace without redundant UUID generation or adding unrelated default roots',()=>{
  const prepared=prepare(v3()),base:any={chats:[chat('existing')],folders:{},contentStore:{},xBase:{opaqueRef:55}};
  const result=call({operation:'plan',mode:'replace',base,source:prepared.source,newIDs:[],now:20}),output=apply(base,result.changes);
  expect(output.chats).toEqual(prepared.source.chats);expect(output.xBase).toEqual({opaqueRef:55});expect(output).not.toHaveProperty('apiKey');expect(output).not.toHaveProperty('currentChatIndex');expect(result.currentChatIndex).toBe(0);
 });
 it('resets all known initial roots including undefined values only when settings replacement is selected',()=>{
  const prepared=prepare(v3()),defaults=call({operation:'defaults'});
  const base={...defaults,chats:[chat('existing')],theme:'custom',apiKey:'FAKE ONLY',evaluationSettings:{safetyPreSend:'off'},xOpaque:{opaqueRef:91}};
  const keep=call({operation:'plan',mode:'replace',base,source:prepared.source,includeSettings:false,newIDs:[]});
  expect(apply(base,keep.changes).theme).toBe('custom');expect(apply(base,keep.changes).apiKey).toBe('FAKE ONLY');
  const reset=apply(base,call({operation:'plan',mode:'replace',base,source:prepared.source,includeSettings:true,newIDs:[]}).changes);
  expect(reset.theme).toBe(defaults.theme);expect(reset.evaluationSettings).toEqual(defaults.evaluationSettings);expect(reset).not.toHaveProperty('apiKey');expect(reset.xOpaque).toEqual({opaqueRef:91});
 });
 it('reports missing content and disallows selected import instead of silently accepting the placeholder',()=>{
  const data:any={...v3(),chats:[{...chat(),messages:[],branchTree:{rootId:'node',activePath:['node'],nodes:{node:{id:'node',parentId:null,role:'user',contentHash:'missing',createdAt:1}}}}]};const result=prepare(data);
  expect(result.status).toBe('ready');expect(result.source.unavailableContent[result.source.chats[0].id]).toEqual(['missing']);expect(()=>call({operation:'plan',mode:'append',base:{chats:[],folders:{},contentStore:{}},source:result.source,newIDs:ids(),now:1})).toThrow('cannotImportMissingContent');
 });
 it('returns explicit decisions for partial OpenAI import and does not accept a cancelled decision',()=>{
  const mapping:any={root:{id:'root',parent:null,children:['empty'],message:{author:{role:'user'},content:{parts:['hello']}}},empty:{id:'empty',parent:null,children:[],message:{author:{role:'assistant'},content:{parts:['child']}}}};
  const data:any={title:'OpenAI',mapping,current_node:'empty'};const original=importUtils.importOpenAIChatExport;vi.spyOn(importUtils,'importOpenAIChatExport').mockImplementation((value,allow)=>{if(!allow)throw new importUtils.PartialImportError('partial',chat() as any);return original(value,allow);});const first=prepare(data);expect(first.status).toBe('decision-required');expect(first.decision.kind).toBe('partial-import');expect(first).not.toHaveProperty('source');
  expect(prepare(data,{decisions:{allowPartialImport:false}}).status).toBe('failed');expect(prepare(data,{decisions:{allowPartialImport:true}}).status).toBe('ready');
 });
 it('supports an explicitly allowed empty preview and replace, while empty append remains rejected',()=>{
  const data={version:3,chats:[],folders:{},contentStore:{}};expect(prepare(data).status).toBe('failed');expect(prepare({version:3,chats:[],folders:{}},{allowEmpty:true}).status).toBe('failed');const prepared=prepare(data,{allowEmpty:true});expect(prepared.status).toBe('ready');
  const base={chats:[chat()],folders:{},contentStore:{},xRoot:{opaqueRef:77}};const result=call({operation:'plan',mode:'replace',base,source:prepared.source,newIDs:[]});expect(apply(base,result.changes).chats).toEqual([]);expect(result.currentChatIndex).toBe(-1);
  expect(()=>call({operation:'plan',mode:'append',base,source:prepared.source,newIDs:[]})).toThrow('nothingImported');
 });
 it('uses the Web Playground classifier for model-less settings at the raw boundary',()=>{
  const data={messages:[{role:'user',content:'hello'}],temperature:0.7,max_tokens:123};
  const inspected=call({operation:'inspect',kind:'data',data});
  expect(inspected.opaquePaths).not.toContainEqual(['temperature']);expect(inspected.opaquePaths).not.toContainEqual(['max_tokens']);
  const prepared=prepare(data);expect(prepared.status).toBe('ready');expect(prepared.source.chats[0].config.temperature).toBe(0.7);
  const tree=prepared.source.chats[0].branchTree;expect(resolveContent(prepared.source.contentStore,tree.nodes[tree.rootId].contentHash)).toEqual([{type:'text',text:'hello'}]);
 });
 it('provides actual defaults and shared raw projection paths without including runtime actions',()=>{
  const defaults=call({operation:'defaults'});expect(defaults.chats).toEqual([]);expect(defaults.contentStore).toEqual({});expect(defaults.evaluationSettings.safetyPreSend).toBe('manual');expect(defaults).not.toHaveProperty('setChats');
  const data:any=v3();data.chats[0].config.max_tokens=9007199254740993;const inspected=call({operation:'inspect',kind:'data',data});expect(inspected.contentStorePaths).toEqual([['contentStore']]);expect(inspected.opaquePaths).toContainEqual(['xRoot']);expect(inspected.opaquePaths).toContainEqual(['chats',0,'config','max_tokens']);expect(inspected.opaquePaths).toContainEqual(['chats',0,'messages',0,'xMessage']);expect(inspected.opaquePaths).not.toContainEqual(['chats',0,'config','temperature']);
 });
});

describe('old iOS JSON file import',()=>{
 it.each([actualIOSState,actualIOSSnapshot])('accepts JSON produced by the unchanged old Swift writer',data=>{
  const result=prepare(data);expect(result.status).toBe('ready');expect(result.type).toBe('ExportV3');
  expect(result.source.chats).toHaveLength(2);
  expect(result.source.contentStore).toMatchObject(data.contentStore);
  const tree=result.source.chats[0].branchTree;
  expect(tree.nodes.inactive.contentHash).toBe('inactive');
  expect(tree.nodes.user.contentHash).toBe('rich');
  expect(resolveContent(result.source.contentStore,'rich')).toEqual(data.contentStore.rich.content);
  expect(result.source.extensions.currentChatID).toBe(data.currentChatID);
  expect(result.source.folders).toMatchObject(data.folders);
 });

 it.each(['state','snapshot'])('prepares the actual old %s writer shape through V3 without changing its input',kind=>{
  const data:any=structuredClone(legacyIOSState);
  if(kind==='snapshot'){delete data.version;Object.assign(data,{snapshotVersion:1,updatedAt:1712345678901,deviceId:'old-ios-device',currentChatID:'old-ios-chat'});}
  const before=structuredClone(data),inspected=call({operation:'inspect',kind:'data',data});
  expect(inspected.normalizationChanges).toContainEqual({op:'set',path:['version'],value:3});
  expect(inspected.normalizationChanges).toContainEqual({op:'set',path:['chats',0,'branchTree','nodes','root','parentId'],value:null});
  const normalized=apply(data,inspected.normalizationChanges);
  expect(normalized).toEqual(normalizeLegacyIOSImport(data));
  expect(inspected.contentStorePaths).toEqual([['contentStore']]);expect(inspected.opaquePaths).toContainEqual(['unknownRoot']);
  if(kind==='snapshot')expect(inspected.opaquePaths).toContainEqual(['snapshotVersion']);
  const result=prepare(data),fromPatch=prepare(normalized);
  expect(result.status).toBe('ready');expect(result.type).toBe('ExportV3');expect(fromPatch.source).toEqual(result.source);
  expect(result.source.contentStore).toEqual(data.contentStore);
  const tree=result.source.chats[0].branchTree;
  expect(tree.activePath).toEqual(['root']);expect(Object.keys(tree.nodes)).toEqual(['root','inactive']);
  expect(tree.nodes.root.unknownNode).toEqual(data.chats[0].branchTree.nodes.root.unknownNode);
  expect(resolveContent(result.source.contentStore,tree.nodes.root.contentHash)[0]).toMatchObject({text:'Hashed body'});
  expect(result.source.extensions.unknownRoot).toEqual(data.unknownRoot);
  if(kind==='snapshot')expect(result.source.extensions).toMatchObject({snapshotVersion:1,updatedAt:1712345678901,deviceId:'old-ios-device',currentChatID:'old-ios-chat'});
  expect(data).toEqual(before);
  expect(call({operation:'inspect',kind:'state',data})).not.toHaveProperty('normalizationChanges');
  expect(call({operation:'inspect',kind:'source',data})).not.toHaveProperty('normalizationChanges');
 });
 it('imports colliding old IDs and hashes through the existing append planner',()=>{
  const source=prepare(legacyIOSState).source;
  const base:any={chats:[{...chat('old-ios-chat'),title:'Existing'}],folders:{},contentStore:{body:{content:[{type:'text',text:'Existing body'}],refCount:1}},evaluationResults:{}};
  const output=apply(base,call({operation:'plan',mode:'append',base,source,newIDs:ids().map(id=>`append-${id}`),now:10}).changes);
  expect(output.chats[0].id).not.toBe(base.chats[0].id);expect(output.chats[1]).toEqual(base.chats[0]);
  expect(output.chats[0].branchTree.nodes.root.contentHash).toBe('body_');
  expect(output.contentStore.body).toEqual(base.contentStore.body);expect(output.contentStore.body_).toEqual(legacyIOSState.contentStore.body);
  const replaced=apply(base,call({operation:'plan',mode:'replace',base,source,newIDs:[]}).changes);
  expect(replaced.contentStore.unreferenced).toEqual(legacyIOSState.contentStore.unreferenced);
 });
 it('accepts flat chats and keeps normal inline Web V1 on its existing path',()=>{
  const flat={...legacyIOSState,chats:[chat()]};expect(prepare(flat).type).toBe('ExportV3');
  const inline={...flat,chats:[{...chat(),branchTree:{rootId:'n',activePath:['n'],nodes:{n:{id:'n',parentId:null,role:'user',content:chat().messages[0].content}}}}]};
  expect(normalizeLegacyIOSImport(inline)).toBe(inline);expect(call({operation:'inspect',kind:'data',data:inline})).not.toHaveProperty('normalizationChanges');
  expect(prepare({version:1,chats:[chat()],folders:{}}).type).toBe('ExportV1');
 });
 it('rejects unsupported versions and malformed old roots without changing them',()=>{
  const snapshot:any={...legacyIOSState,snapshotVersion:1,updatedAt:1,deviceId:'device'};delete snapshot.version;
  for(const data of [{...snapshot,snapshotVersion:2},{...snapshot,snapshotVersion:'1'},{...snapshot,deviceId:1},{...snapshot,folders:[]},{...legacyIOSState,contentStore:[]},{...legacyIOSState,chats:[{...chat(),branchTree:{nodes:{bad:{contentHash:1}}}}]}]){
   const before=structuredClone(data);expect(()=>prepare(data)).toThrow();expect(data).toEqual(before);
  }
  for(const version of [0,4,99])expect(()=>prepare({...legacyIOSState,version})).toThrow();
 });
});
