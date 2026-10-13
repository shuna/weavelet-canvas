import {describe,expect,it,vi,afterEach} from 'vitest';
import {fileExport} from '../../shared/google-sync/fileExport';
import {buildFileExportPayload} from './fileExport';
import {materializeActivePath} from './branchUtils';
import {addContent,addContentDelta} from './contentStore';
function source(){
 const contentStore:any={body:{content:[{type:'text',text:'Hello',xPart:{opaqueRef:1}},{type:'text',text:'Second'},{type:'image_url',image_url:{url:'data:fake',detail:'high'}},{type:'reasoning',text:'thought'},{type:'tool_result',tool_call_id:'fake',content:'result'}],refCount:1,xEntry:{opaqueRef:2}},hidden:{content:[{type:'text',text:'Hidden'}],refCount:1},unused:{content:[{type:'text',text:'Unused'}],refCount:0,xEntry:{opaqueRef:3}}};
 const branchTree:any={nodes:{root:{id:'root',parentId:null,role:'user',contentHash:'body',createdAt:1000,xNode:{opaqueRef:4}},hidden:{id:'hidden',parentId:'root',role:'assistant',contentHash:'hidden',createdAt:2000}},rootId:'root',activePath:['root'],xTree:{opaqueRef:5},messageAttributesV1:{version:1,byNode:{root:{xMessage:{opaqueRef:6}}}}};
 const a:any={id:'a',title:'Title',titleSet:true,imageDetail:'auto',config:{model:'FAKE',systemPrompt:'System',xConfig:{opaqueRef:7}},folder:'folder',branchTree,messages:materializeActivePath(branchTree,contentStore,true),collapsedNodes:{hidden:true},omittedNodes:{hidden:true},protectedNodes:{root:true},xChat:{opaqueRef:8}};
 const b:any={id:'b',title:'Other',titleSet:true,imageDetail:'auto',config:{model:'FAKE'},messages:[{role:'user',content:[{type:'text',text:'Other body'}]}]};
 return {version:3,chats:[a,b],contentStore,folders:{folder:{id:'folder',name:'Folder',order:0,expanded:false,xFolder:{opaqueRef:9}}},evaluationSettings:{xEvaluation:{opaqueRef:10}},evaluationResults:{'a:test':{xResult:{opaqueRef:11}},'b:test':{xResult:{opaqueRef:12}}},xRoot:{opaqueRef:13}} as any;
}
const call=(v3:any,format:string,extra:any={})=>JSON.parse(fileExport(JSON.stringify({v3,format,scope:'all',...extra})));
afterEach(()=>vi.restoreAllMocks());
describe('shared file export payloads',()=>{
 it('keeps full V3 roots, unknown fields, hidden nodes, unused entries, entry metadata and source unchanged',()=>{
  const v3=source(),before=structuredClone(v3),result=call(v3,'v3');expect(result).toEqual({payload:before,payloadChanges:[],mimeType:'application/json',extension:'json'});expect(v3).toEqual(before);
 });
 it('expands V3 delta body while preserving entry attributes and the original source encoding',()=>{
  const v3=source(),base=addContent(v3.contentStore,[{type:'text',text:'Long '.repeat(1000)}]),hash=addContentDelta(v3.contentStore,[{type:'text',text:'Long '.repeat(1000)+'end'}],base);v3.contentStore[hash].xEntry={opaqueRef:40};const before=structuredClone(v3);
  const result=call(v3,'v3');expect(v3.contentStore[hash].delta).toBeDefined();expect(result.payload.contentStore[hash]).toEqual({content:[{type:'text',text:'Long '.repeat(1000)+'end'}],refCount:1,xEntry:{opaqueRef:40}});expect(v3).toEqual(before);
 });
 it('exports selected V3 chat with folder removed and evaluation IDs filtered, retaining all or visible node metadata',()=>{
  const v3=source(),result=call(v3,'v3',{scope:'chat',chatId:'a'}).payload;
  expect(result.folders).toEqual({});expect(result.chats[0]).not.toHaveProperty('folder');expect(result.chats[0].xChat).toEqual({opaqueRef:8});expect(result.evaluationResults).toEqual({'a:test':{xResult:{opaqueRef:11}}});expect(Object.keys(result.contentStore)).toEqual(['body','hidden']);expect(Object.keys(result.chats[0].branchTree.nodes)).toEqual(['root','hidden']);
  const visible=call(v3,'v3',{scope:'chat',chatId:'a',visibleBranchOnly:true}).payload;expect(Object.keys(visible.chats[0].branchTree.nodes)).toEqual(['root']);expect(Object.keys(visible.contentStore)).toEqual(['body']);expect(visible.chats[0].collapsedNodes).toEqual({});expect(visible.chats[0].protectedNodes).toEqual({root:true});expect(visible.chats[0].messages[0].xMessage).toEqual({opaqueRef:6});expect(visible.chats[0].branchTree.xTree).toEqual({opaqueRef:5});
 });
 it('retains legacy V1 shape and its existing omissions without changing the source',()=>{
  const v3=source(),before=structuredClone(v3),result=call(v3,'v1').payload;expect(Object.keys(result)).toEqual(['chats','folders','version']);expect(result.version).toBe(1);expect(result.chats[0]).not.toHaveProperty('branchTree');expect(result.chats[0]).not.toHaveProperty('collapsedNodes');expect(result.chats[0].messages).toEqual(before.chats[0].messages);expect(result.chats[0].omittedNodes).toEqual({hidden:true});expect(result.folders).toEqual(before.folders);expect(v3).toEqual(before);
 });
 it('uses OpenAI text mapping for all branches or the selected branch and single-chat array wrapper',()=>{
  const v3=source(),all=call(v3,'openai').payload;expect(all).toHaveLength(2);expect(all[0]).toEqual({title:'Title',create_time:1,current_node:'root',mapping:{__system__:{id:'__system__',message:{author:{role:'system'},content:{parts:['System']},metadata:{model_slug:'FAKE'}},parent:null,children:['root']},root:{id:'root',message:{author:{role:'user'},content:{parts:['Hello','Second']},metadata:{model_slug:'FAKE'}},parent:'__system__',children:['hidden']},hidden:{id:'hidden',message:{author:{role:'assistant'},content:{parts:['Hidden']},metadata:{model_slug:'FAKE'}},parent:'root',children:[]}}});
  const single=call(v3,'openai',{scope:'chat',chatId:'a',visibleBranchOnly:true}).payload;expect(single).toHaveLength(1);expect(Object.keys(single[0].mapping)).toEqual(['__system__','root']);expect(single[0].mapping.root.children).toEqual([]);
 });
 it('uses OpenRouter current-branch text schema and its single-object/all-array wrappers',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  try{const v3=source(),single=call(v3,'openrouter',{scope:'chat',chatId:'a'}).payload;expect(single.version).toBe('orpg.3.0');expect(single.title).toBe('Title');expect(Object.values(single.items).map((item:any)=>item.data.content)).toEqual([[{type:'output_text',text:'System'}],[{type:'input_text',text:'Hello\nSecond'}]]);expect(Object.values(single.messages).map((message:any)=>message.type)).toEqual(['system','user']);expect(Object.values(single.characters).map((character:any)=>character.model)).toEqual(['FAKE']);expect(call(v3,'openrouter').payload).toHaveLength(2);}finally{vi.useRealTimers();}
 });
 it('uses LM Studio current-branch text/config fields and its single-object/all-array wrappers',()=>{
  const v3=source(),single=call(v3,'lmstudio',{scope:'chat',chatId:'a'}).payload;expect(single.name).toBe('Title');expect(single.systemPrompt).toBe('System');expect(single.createdAt).toBe(1000);expect(single.lastUsedModel.identifier).toBe('FAKE');expect(single.messages).toEqual([{versions:[{type:'singleStep',role:'user',content:[{type:'text',text:'Hello\nSecond'}]}],currentlySelected:0}]);expect(call(v3,'lmstudio').payload).toHaveLength(2);
 });
 it('uses pure Markdown text/image rules and closes continued code blocks, without DOM',()=>{
  const v3=source(),result=call(v3,'markdown',{scope:'chat',chatId:'a'});expect(result).toEqual({payload:'# Title\n\n### **user**:\n\nHello\n\nSecond\n\n![image](data:fake)\n\n\n\n\n\n---\n\n',mimeType:'text/markdown',extension:'md'});
  v3.chats[1].messages=[{role:'assistant',content:[{type:'text',text:'```swift\nfirst'}]},{role:'assistant',content:[{type:'text',text:'second'}]}];expect(call(v3,'markdown',{scope:'chat',chatId:'b'}).payload).toBe('# Other\n\n### **assistant**:\n\n```swift\nfirst\n\nsecond\n\n\n```\n---\n\n');
 });
 it('shares the actual viewing-path projection before visible export, rejecting unsupported selections',()=>{
  const v3=source(),before=structuredClone(v3),result=call(v3,'v3',{scope:'chat',chatId:'a',visibleBranchOnly:true,visiblePath:['root','hidden']}).payload;expect(result.chats[0].branchTree.activePath).toEqual(['root','hidden']);expect(result.chats[0].messages.map((m:any)=>m.content[0].text)).toEqual(['Hello','Hidden']);expect(v3).toEqual(before);
  expect(()=>call(v3,'openrouter',{scope:'chat',chatId:'a',visibleBranchOnly:true})).toThrow('current branch');expect(()=>call(v3,'markdown')).toThrow('Unsupported all-chat');expect(()=>call(v3,'v1',{scope:'chat',chatId:'a'})).toThrow('Unsupported single-chat');expect(()=>call(v3,'v3',{scope:'chat',chatId:'missing'})).toThrow('missing');
 });
 it('safely converts missing config without inserting a new config into the V3/raw source',()=>{
  const v3=source();delete v3.chats[0].config;const before=structuredClone(v3);for(const format of ['openai','openrouter','lmstudio'])expect(()=>call(v3,format)).not.toThrow();expect(call(v3,'openai').payload[0].mapping.root.message.metadata.model_slug).toBe('');expect(v3).toEqual(before);expect((buildFileExportPayload({v3,format:'v3',scope:'all'}) as any).chats[0]).not.toHaveProperty('config');
 });
});
