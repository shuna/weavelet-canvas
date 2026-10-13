import {describe, expect, it} from 'vitest';
import {branchDiff} from './branchDiff';
import {branchDiff as nativeBranchDiff} from '../../shared/google-sync/branchLayout';
import {addContent, addContentDelta, type ContentStoreData} from './contentStore';
import type {BranchTree} from '../types/chat';

const node = (id: string, role: 'user'|'assistant', contentHash: string) =>
  ({id, role, contentHash, parentId:null, createdAt:1});

describe('shared branch diff rows', () => {
  it('keeps row order, A-side role precedence, text-only joins, and both original texts', () => {
    const tree = {nodes:{a:node('a','user','a'),b:node('b','assistant','b'),extra:node('extra','assistant','extra')}} as unknown as BranchTree;
    const contentStore = {
      a:{content:[{type:'text',text:'hello'},{type:'reasoning',text:'hidden'},{type:'text',text:'world'}],refCount:1},
      b:{content:[{type:'text',text:'hello there'}],refCount:1},
      extra:{content:[{type:'text',text:'last'}],refCount:1},
    } as ContentStoreData;
    const input = {tree,contentStore,pathA:['a'],pathB:['b','extra']};
    const before = JSON.stringify(input);
    const result = branchDiff(input);
    expect(result.hasChanges).toBe(true);
    expect(result.rows.map(({role,textA,textB}) => ({role,textA,textB}))).toEqual([
      {role:'user',textA:'hello world',textB:'hello there'},
      {role:'assistant',textA:'',textB:'last'},
    ]);
    expect(result.rows[0].segments).toEqual([
      {type:'equal',text:'hello '},{type:'removed',text:'world'},{type:'added',text:'there'},
    ]);
    expect(JSON.parse(nativeBranchDiff(before))).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('resolves stored deltas and leaves identical or empty paths unchanged', () => {
    const contentStore: ContentStoreData = {};
    const baseText = 'same words '.repeat(40) + 'old';
    const base = addContent(contentStore,[{type:'text',text:baseText}]);
    const delta = addContentDelta(contentStore,[{type:'text',text:'same words '.repeat(40) + 'new'}],base);
    expect(contentStore[delta].delta).toBeDefined();
    const tree = {nodes:{a:node('a','user',base),b:node('b','user',delta)}} as unknown as BranchTree;
    const raw = JSON.stringify(contentStore);
    expect(branchDiff({tree,contentStore,pathA:['a'],pathB:['a']})).toMatchObject({hasChanges:false});
    expect(branchDiff({tree,contentStore,pathA:[],pathB:[]})).toEqual({rows:[],hasChanges:false});
    const result = JSON.parse(nativeBranchDiff(JSON.stringify({tree,contentStore,pathA:['a'],pathB:['b']})));
    expect(result.rows[0].textA).toBe(baseText);
    expect(result.rows[0].textB).toBe('same words '.repeat(40) + 'new');
    expect(result.hasChanges).toBe(true);
    expect(JSON.stringify(contentStore)).toBe(raw);
  });

  it('keeps the existing missing-path behavior', () => {
    const tree = {nodes:{}} as unknown as BranchTree;
    expect(branchDiff({tree,contentStore:{},pathA:['missing'],pathB:[]})).toMatchObject({
      hasChanges:false,rows:[{role:'unknown',textA:'',textB:''}],
    });
  });
});
