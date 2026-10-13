import {describe, expect, it} from 'vitest';
import {layoutBranchEntries, type WorkerInput} from './branchLayout';
import {branchLayout} from '../../shared/google-sync/branchLayout';
import {branchEnsure} from '../../shared/google-sync/branchLayout';
import type {ChatInterface} from '../types/chat';
import type {DocumentPatch} from './jsonChanges';

const input = (text: string): WorkerInput => ({requestId:7,entries:[{
  chatIndex:0,chatId:'chat',chatTitle:'title',activePath:['root'],
  nodes:{root:{id:'root',parentId:null,role:'user',contentHash:'body'}},
}],contentStore:{body:{content:[{type:'text',text}],refCount:1}}});

describe('native branch layout bridge', () => {
  it('replaces only a preview surrogate cut by the Web 80-unit limit', () => {
    const request = input('x'.repeat(79) + '😀');
    const before = JSON.stringify(request);
    const web = layoutBranchEntries(request);
    expect(web.rfNodes[0].data.contentPreview).toBe('x'.repeat(79) + '\ud83d...');
    const native = JSON.parse(branchLayout(before));
    expect(native).toEqual({...web,rfNodes:web.rfNodes.map(node => ({...node,data:{...node.data,contentPreview:'x'.repeat(79) + '�...'}}))});
    expect(native.rfNodes[0].data.contentPreview).toBe(new TextDecoder().decode(new TextEncoder().encode(web.rfNodes[0].data.contentPreview)));
    expect(JSON.stringify(request)).toBe(before);
  });

  it('keeps valid non-BMP previews and the worker node/edge order', () => {
    const request = input('valid 😀 𠀀');
    request.entries[0].nodes.a = {id:'a',parentId:'b',role:'assistant',contentHash:'body'};
    request.entries[0].nodes.b = {id:'b',parentId:'a',role:'assistant',contentHash:'body'};
    expect(JSON.parse(branchLayout(JSON.stringify(request)))).toEqual(layoutBranchEntries(request));
  });
});

const apply = (root: any, patches: DocumentPatch[]) => {
  for (const patch of patches) {
    let owner = root;
    for (const key of patch.path.slice(0, -1)) owner = owner[key];
    const key = patch.path.at(-1)!;
    if (patch.op === 'set') owner[key] = patch.value;
    else if (patch.op === 'remove') delete owner[key];
    else {
      const target = patch.path.reduce((value, part) => value[part], root);
      const ordered = Object.fromEntries(patch.keys.map(name => [name, target[name]]));
      for (const name of Object.keys(target)) delete target[name];
      Object.assign(target, ordered);
    }
  }
  return root;
};

it('materializes a flat chat through the Web ensure path and preserves original attributes', () => {
  const chat = {
    id:'chat',title:'old',titleSet:true,imageDetail:'auto',config:{},
    messages:[
      {role:'user',content:[{type:'text',text:'hello'}],custom:{raw:'kept'}},
      {role:'assistant',content:[{type:'text',text:'world'}]},
    ], collapsedNodes:{'0':true}, unknownChat:{large:'unchanged'},
  } as unknown as ChatInterface;
  const before = {chat,contentStore:{unrelated:{content:[{type:'text',text:'else'}],refCount:1, unknown:123}}};
  const json = JSON.stringify({ ...before, newIDs:['node-1','node-2'],now:10000 });
  const patches = JSON.parse(branchEnsure(json)) as DocumentPatch[];
  const after = apply(structuredClone(before), patches);
  const [first, second] = after.chat.branchTree.activePath;
  expect(first).toBeTruthy();
  expect(second).not.toBe(first);
  expect(after.chat.branchTree.nodes[first].createdAt).toBe(8000);
  expect(after.chat.collapsedNodes).toEqual({[first]:true});
  expect(after.chat.branchTree.messageAttributesV1.byNode[first].custom).toEqual({raw:'kept'});
  expect(after.chat.unknownChat).toEqual({large:'unchanged'});
  expect(after.contentStore.unrelated).toEqual(before.contentStore.unrelated);
  expect(JSON.parse(json).chat.branchTree).toBeUndefined();
});
