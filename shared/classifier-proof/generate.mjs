import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url), directory = path.join(root,'shared/classifier-proof');
const output = path.join(directory,'ClassifierProofResources'), check = process.argv.includes('--check');
const assets = {}, inputs = {};
const hash = data => createHash('sha256').update(data).digest('hex');
function emit(name, data) {
  data = Buffer.from(data); assets[name] = {bytes:data.length,sha256:hash(data)};
  const file = path.join(output,name);
  if (check) { if (!readFileSync(file).equals(data)) throw Error('Stale classifier proof asset: '+name); }
  else { mkdirSync(path.dirname(file),{recursive:true}); writeFileSync(file,data); }
}
function source(file) { const data=readFileSync(path.join(root,file)); inputs[file]=hash(data); return data; }
const hf=JSON.parse(source('node_modules/@huggingface/transformers/package.json'));
const ort=JSON.parse(source('node_modules/onnxruntime-web/package.json'));
if (hf.version !== '4.3.0' || ort.version !== '1.31.0-dev.20260914-8d85527a0') throw Error('Classifier proof requires the parent-selected fixed browser packages.');
const result=await build({entryPoints:[path.join(directory,'worker.ts')],bundle:true,format:'esm',target:'es2022',platform:'browser',minify:true,write:false,metafile:true,
  plugins:[{name:'wasm-only',setup(build){build.onResolve({filter:/^onnxruntime-web\/webgpu$/},()=>({path:path.join(root,'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs')}));}}]});
for(const name of Object.keys(result.metafile.inputs)) source(name);
emit('worker.js',result.outputFiles[0].contents);
for(const name of ['host.js','index.html']) emit(name,source('shared/classifier-proof/'+name));
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) emit(name,source('node_modules/onnxruntime-web/dist/'+name));
// ORT ships upstream-generated ONNX protobuf bindings. This is a tiny trusted constant-logit test graph, not a safety model.
const schema='node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js';source(schema);
const {onnx}=require(path.join(root,schema));
const tensorType=(name,elemType,dims)=>({name,type:{tensorType:{elemType,shape:{dim:dims.map(d=>typeof d==='string'?{dimParam:d}:{dimValue:d})}}}});
const graph={name:'trusted_classifier_fixture',input:['input_ids','attention_mask','token_type_ids'].map(n=>tensorType(n,7,['batch','sequence'])),output:[tensorType('logits',1,[1,2])],node:[{name:'fixture_logits',opType:'Constant',output:['logits'],attribute:[{name:'value',type:4,t:{dims:[1,2],dataType:1,floatData:[0,2]}}]}]};
const model=onnx.ModelProto.create({irVersion:8,producerName:'Weavelet trusted proof fixture',opsetImport:[{domain:'',version:13}],graph});
const error=onnx.ModelProto.verify(model);if(error)throw Error(error);
emit('model/onnx/model_quantized.onnx',onnx.ModelProto.encode(model).finish());
const json=(name,value)=>emit('model/'+name,JSON.stringify(value)+'\n');
json('config.json',{model_type:'bert',architectures:['BertForSequenceClassification'],num_labels:2,id2label:{'0':'FIXTURE_ZERO','1':'FIXTURE_TWO'}});
json('tokenizer_config.json',{tokenizer_class:'BertTokenizer',model_max_length:128,do_lower_case:true,unk_token:'[UNK]',sep_token:'[SEP]',pad_token:'[PAD]',cls_token:'[CLS]',mask_token:'[MASK]'});
json('tokenizer.json',{version:'1.0',truncation:null,padding:null,added_tokens:[],normalizer:{type:'BertNormalizer',clean_text:true,handle_chinese_chars:true,strip_accents:null,lowercase:true},pre_tokenizer:{type:'BertPreTokenizer'},post_processor:{type:'BertProcessing',sep:['[SEP]',3],cls:['[CLS]',2]},decoder:{type:'WordPiece',prefix:'##',cleanup:true},model:{type:'WordPiece',unk_token:'[UNK]',continuing_subword_prefix:'##',max_input_chars_per_word:100,vocab:{'[PAD]':0,'[UNK]':1,'[CLS]':2,'[SEP]':3,'[MASK]':4,'hello':5}}});
source('node_modules/esbuild/package.json'); source('node_modules/protobufjs/package.json');
source('shared/classifier-proof/generate.mjs');source('src/workers/transformersWorker.ts');
const ortRevision = '8d85527a010e294a26b274749f74294b2a32cec5';
const licenseSources = {};
for (const name of ['LICENSE','ThirdPartyNotices']) {
  const filename = 'shared/classifier-proof/licenses/onnxruntime-8d85527a-' + name + '.txt';
  const data = source(filename);
  emit('ORT-' + name + '.txt',data);
  licenseSources[filename] = 'https://github.com/microsoft/onnxruntime/blob/' + ortRevision + '/' + (name === 'LICENSE' ? name : name + '.txt');
}
const notices = [];
for (const name of ['@huggingface/transformers','@huggingface/tokenizers','@huggingface/jinja']) {
  const base = 'node_modules/' + name, metadata = JSON.parse(source(base + '/package.json'));
  notices.push('License notice: ' + name + '@' + metadata.version + '\n' + source(base + '/LICENSE').toString());
}
emit('NOTICE.txt',notices.join('\n\n'));
source('node_modules/@huggingface/tokenizers/types/static/tokenizer.d.ts');
const provenance={purpose:'Offline WK trusted synthetic fixture proof only; not a safety classifier or product adoption',versions:{transformers:hf.version,onnxruntimeWeb:ort.version},schemaSource:'https://github.com/onnx/onnx/blob/main/onnx/onnx.proto',tokenizerSchemaSource:'installed @huggingface/tokenizers types/static/tokenizer.d.ts and implementations',licenseSources,inputs,assets,totalAssetBytes:Object.values(assets).reduce((n,a)=>n+a.bytes,0)};
const manifest=JSON.stringify(provenance,null,2)+'\n';
if(check){if(readFileSync(path.join(output,'provenance.json'),'utf8')!==manifest)throw Error('Stale classifier proof provenance');}
else writeFileSync(path.join(output,'provenance.json'),manifest);
console.log(JSON.stringify({versions:provenance.versions,totalAssetBytes:provenance.totalAssetBytes,totalBundleBytes:provenance.totalAssetBytes+Buffer.byteLength(manifest)}));
