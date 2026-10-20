import {describe, expect, it} from 'vitest';
import {localModelImport} from '../../shared/google-sync/localModelImport';
import {localModelFiles} from '../../shared/google-sync/localModelFiles';
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
  it('exposes curated download metadata and keeps catalog registration role-neutral', () => {
    const catalog = run({operation:'catalog'});
    expect(catalog.map((model:{id:string}) => model.id)).toEqual([
      'smollm2-360m-instruct-q8', 'qwen3-0.6b-q4km', 'llm-jp-3-1.8b-instruct-q4km',
    ]);
    const plan = run({operation:'catalogPlan',id:'smollm2-360m-instruct-q8'});
    expect(plan.files[0]).toEqual({
      path:'smollm2-360m-instruct-q8_0.gguf',
      url:'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf',
    });
    const model = run({operation:'catalogDefinition',id:plan.model.id,totalBytes:456});
    expect(model).toMatchObject({id:plan.model.id,origin:plan.model.huggingFaceRepo,source:'opfs',fileSize:456});
    expect(run({operation:'catalogCommit',state:{localModels:[],activeLocalModels:{generation:'',analysis:'existing'}},model}).changes).toEqual([
      {op:'set',path:['localModels',0],value:model},
    ]);
    expect(run({operation:'catalogCommit',state:{localModels:[model],activeLocalModels:{generation:'existing'}},model,existingIDs:[model.id]}).changes).toEqual([]);
  });
  it('consolidates a downloaded catalog duplicate without losing unrelated state', () => {
    const downloaded = {...prepared.model,id:'downloaded'};
    const duplicate = {...prepared.model,id:'stored',tasks:['generation','analysis']};
    const state = {
      localModels:[downloaded,duplicate,{...prepared.model,id:'other'}],
      activeLocalModels:{generation:'downloaded',analysis:'other',opaque:'keep'},
      favoriteLocalModelIds:['downloaded','other'],
      savedModelMeta:{downloaded:{partial:true},other:{opaque:true}},
    };
    const changes = run({operation:'catalogDuplicateCommit',state,downloadedID:'downloaded',duplicate}).changes;
    expect(changes).toEqual(expect.arrayContaining([
      {op:'remove',path:['savedModelMeta','downloaded']},
      {op:'set',path:['activeLocalModels','generation'],value:'stored'},
      {op:'set',path:['favoriteLocalModelIds',0],value:'other'},
      {op:'set',path:['favoriteLocalModelIds',1],value:'stored'},
    ]));
    expect(JSON.stringify(changes)).toContain('"other"');
  });
  it('removes the downloaded opaque model through its aligned ID', () => {
    const duplicate = {id:'stored',tasks:['generation']};
    const changes = run({operation:'catalogDuplicateCommit',localModelIDs:['downloaded','other'],downloadedID:'downloaded',duplicate,state:{
      localModels:[{opaqueRef:0},{opaqueRef:1}], activeLocalModels:{}, favoriteLocalModelIds:[], savedModelMeta:{},
    }}).changes;
    expect(changes).toEqual(expect.arrayContaining([
      {op:'set',path:['localModels',0],value:{opaqueRef:1}},
      {op:'remove',path:['localModels',1]},
    ]));
  });
});

describe('selected GGUF import', () => {
  const shards = [
    {name:'model-00002-of-00002.gguf',size:7,hash:'second'},
    {name:'model-00001-of-00002.gguf',size:5,hash:'first'},
  ];

  it('shares ordered shard validation, preparation, complete duplicate matching, and final registration', () => {
    expect(run({operation:'fingerprintPlan',size:64 * 1024 * 1024 + 1})).toEqual({
      ranges:[{offset:0,length:1024 * 1024},{offset:63 * 1024 * 1024 + 1,length:1024 * 1024}],
      suffix:String(64 * 1024 * 1024 + 1),
    });
    const selection = run({operation:'selection',files:shards.map(({name,size}) => ({name,size}))});
    expect(selection).toEqual({
      files:[{name:'model-00001-of-00002.gguf',size:5},{name:'model-00002-of-00002.gguf',size:7}],
      manifest:{kind:'gguf-sharded',entrypoint:'model-00001-of-00002.gguf',shards:['model-00001-of-00002.gguf','model-00002-of-00002.gguf'],totalSize:12},
      primaryName:'model-00001-of-00002.gguf',displayLabel:'model-00001-of-00002.gguf (2 shards)',totalSize:12,
    });
    const preparedSelection = run({operation:'prepareSelection',files:shards.map(({name,size}) => ({name,size})),hash:'first'.repeat(16)});
    expect(preparedSelection).toMatchObject({existing:false,model:{
      id:'local-file--firstfirstfirstf--model-00001-of-00002-gguf', manifest:selection.manifest, label:selection.displayLabel, fileSize:12,
    }});
    expect(run({operation:'selectionDuplicate',files:shards,candidates:[{
      id:'same',engine:'wllama',kind:'gguf-sharded',hashes:['first','second'],size:12,
    }]})).toBe('same');
    expect(run({operation:'selectionDuplicate',files:shards,candidates:[{
      id:'different-later-shard',engine:'wllama',kind:'gguf-sharded',hashes:['first','different'],size:12,
    }]})).toBeNull();
    expect(() => run({operation:'prepareSelection',files:shards.map(({name,size}) => ({name,size})),hash:'first'.repeat(16),existingIDs:[preparedSelection.model.id]})).toThrow('A different model already uses this ID.');

    const changes = run({operation:'selectionCommit',state:{
      localModels:[],activeLocalModels:{generation:'occupied'},favoriteLocalModelIds:['other'],
    },model:preparedSelection.model}).changes;
    expect(changes).toEqual(expect.arrayContaining([
      {op:'set',path:['localModels',0],value:preparedSelection.model},
      {op:'set',path:['activeLocalModels','analysis'],value:preparedSelection.model.id},
      {op:'set',path:['favoriteLocalModelIds',1],value:preparedSelection.model.id},
    ]));
  });

  it('rejects mixed, incomplete, and gapped shard selections', () => {
    expect(() => run({operation:'selection',files:[
      {name:'one-00001-of-00002.gguf',size:1},{name:'two-00002-of-00002.gguf',size:1},
    ]})).toThrow('異なるモデルのシャードが混在');
    expect(() => run({operation:'selection',files:[
      {name:'model-00001-of-00002.gguf',size:1},{name:'model-00002-of-00003.gguf',size:1},
    ]})).toThrow('シャード総数が一致しません');
    expect(() => run({operation:'selection',files:[
      {name:'model-00001-of-00003.gguf',size:1},{name:'model-00003-of-00003.gguf',size:1},
    ]})).toThrow('シャードセットが不完全');
    expect(() => run({operation:'selection',files:[
      {name:'model-00001-of-00003.gguf',size:1},{name:'model-00003-of-00003.gguf',size:1},{name:'model-00002-of-00003.gguf',size:-1},
    ]})).toThrow('ファイルサイズが不正');
    expect(() => run({operation:'selection',files:[
      {name:'model-00001-of-00003.gguf',size:1},{name:'model-00003-of-00003.gguf',size:1},{name:'model-00001-of-00003.gguf',size:1},
    ]})).toThrow('重複して選択');
  });
});

describe('directory local model files', () => {
  it('keeps the manifest shard order for wllama GGUF files', () => {
    const manifest = {kind:'gguf-sharded' as const,entrypoint:'model-00001-of-00002.gguf',shards:[
      'model-00001-of-00002.gguf','model-00002-of-00002.gguf',
    ],totalSize:8};
    const model = {...prepared.model,id:'split',engine:'wllama' as const,manifest};
    const output = JSON.parse(localModelFiles(JSON.stringify({model,files:[
      'model-00002-of-00002.gguf','model-00001-of-00002.gguf',
    ]})));
    expect(output.requiredFiles).toEqual(manifest.shards);
    expect(output.entrypoint).toBe(manifest.entrypoint);
    expect(output.files).toEqual(['model-00002-of-00002.gguf','model-00001-of-00002.gguf']);
    expect(() => localModelFiles(JSON.stringify({model,files:['model-00001-of-00002.gguf','model-00002-of-00002.gguf.part']}))).toThrow('incomplete');
  });
});
