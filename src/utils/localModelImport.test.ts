import {describe, expect, it} from 'vitest';
import {localModelImport} from '../../shared/google-sync/localModelImport';
const run = (input: object) => JSON.parse(localModelImport(JSON.stringify(input)));

const prepared = run({operation:'prepare', name:'日本語 My Model.GGUF', hash:'0123456789abcdef'.repeat(4), size:1024});

describe('single GGUF import', () => {
  it('uses the Web ID, manifest and task defaults', () => {
    expect(prepared).toEqual({existing:false,model:{
      id:'local-file--0123456789abcdef--my-model-gguf', engine:'wllama',tasks:['generation','analysis'],
      label:'日本語 My Model.GGUF',origin:'日本語 My Model.GGUF',source:'opfs',
      manifest:{kind:'single-file',entrypoint:'日本語 My Model.GGUF'},fileSize:1024,lastFileName:'日本語 My Model.GGUF',
    }});
  });
  it('reuses an installed duplicate and rejects a colliding ID', () => {
    const candidate = {model:{...prepared.model,id:'existing',extra:'keep'},hash:'0123456789abcdef'.repeat(4),size:1024};
    expect(run({operation:'prepare',name:'日本語 My Model.GGUF',hash:candidate.hash,size:1024,candidates:[candidate]})).toEqual({existing:true,model:candidate.model});
    expect(() => run({operation:'prepare',name:'日本語 My Model.GGUF',hash:candidate.hash,size:1024,existingIDs:[prepared.model.id]})).toThrow('A different model already uses this ID.');
  });
  it('appends one definition and fills only empty roles in the delta', () => {
    const state = {localModels:[{opaqueRef:0}],activeLocalModels:{generation:'already',analysis:'',other:{opaqueRef:1}},savedModelMeta:{bytes:9007199254740992}};
    const changes = run({operation:'commit',state,model:prepared.model,existingIDs:['old']}).changes;
    expect(changes).toEqual(expect.arrayContaining([
      {op:'set',path:['localModels',1],value:prepared.model},
      {op:'set',path:['activeLocalModels','analysis'],value:prepared.model.id},
    ]));
    expect(changes.every((change:{path:string[]}) => ['localModels','activeLocalModels'].includes(change.path[0]))).toBe(true);
    expect(JSON.stringify(changes)).not.toContain('savedModelMeta');
  });
});
