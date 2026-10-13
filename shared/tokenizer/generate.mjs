import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'shared/tokenizer'), check = process.argv.includes('--check');
const output = path.join(directory, 'TokenizerResources'), fixture = path.join(directory, 'TokenizerFixtureResources');
const inputs = {}, assets = {}, fixtureAssets = {};
const hash = data => createHash('sha256').update(data).digest('hex');
const source = name => { const data = readFileSync(path.join(root, name)); inputs[name] = hash(data); return data; };
function emit(name, data, testOnly = false) {
  data = Buffer.from(data); (testOnly ? fixtureAssets : assets)[name] = { bytes: data.length, sha256: hash(data) };
  const file = path.join(testOnly ? fixture : output, name);
  if (check) { if (!readFileSync(file).equals(data)) throw Error('Stale tokenizer asset: ' + name); }
  else { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data); }
}
const metadata = JSON.parse(source('node_modules/@dqbd/tiktoken/package.json'));
if (metadata.version !== '1.0.2') throw Error('Tokenizer proof requires fixed @dqbd/tiktoken 1.0.2');
const officialFiles = JSON.parse(source('shared/tokenizer/licenses/npm-1.0.2-file-hashes.json'));
for (const [name, expected] of Object.entries(officialFiles)) {
  if (hash(source('node_modules/@dqbd/tiktoken/' + name)) !== expected) throw Error('Pinned official tokenizer file changed: ' + name);
}
const license = source('shared/tokenizer/licenses/tiktoken-1.0.2-LICENSE.txt');
if (hash(license) !== '418cb499b436128d653d79941333a5437b7be2ea9213dcc2f04d15d5d2c51d86') throw Error('Pinned official tokenizer license changed');
const browser = await build({ entryPoints: [path.join(directory, 'worker.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, write: false, metafile: true,
  plugins: [{ name: 'fixed-native-tiktoken-wasm', setup(build) { build.onResolve({ filter: /^@dqbd\/tiktoken\/lite$/ }, () => ({ path: path.join(directory, 'tiktoken.ts') })); } }] });
for (const name of Object.keys(browser.metafile.inputs)) source(name);
emit('worker.js', browser.outputFiles[0].contents);
emit('tiktoken_bg.wasm', source('node_modules/@dqbd/tiktoken/lite/tiktoken_bg.wasm'));
for (const name of ['host.js', 'index.html']) emit(name, source('shared/tokenizer/' + name));
emit('NOTICE.txt', license);
// Execute the actual Web Worker under Node; expected vectors do not duplicate count or limit logic.
const nodeWorker = await build({ entryPoints: [path.join(root, 'src/workers/tokenizerWorker.ts')], bundle: true, format: 'cjs', platform: 'node', target: 'es2022', write: false,
  external: ['@dqbd/tiktoken/lite'] });
let reply;
const self = { postMessage: value => { reply = value; } };
vm.runInNewContext(nodeWorker.outputFiles[0].text, { self, require: createRequire(import.meta.url), TextEncoder, TextDecoder, WebAssembly, Uint32Array });
const vectorsRaw = source('shared/tokenizer/vectors.json'), vectors = JSON.parse(vectorsRaw);
const expected = [];
for (const [index, vector] of vectors.cases.entries()) {
  await self.onmessage({ data: { id: index, type: 'countTokens', ...vector } });
  if (reply.type === 'error') throw Error(reply.message);
  const count = reply.count;
  await self.onmessage({ data: { id: index, type: 'limitMessages', ...vector } });
  if (reply.type === 'error') throw Error(reply.message);
  expected.push({ count, indices: reply.messages.map(message => vector.messages.findIndex(original => original.id === message.id)) });
}
emit('vectors.json', vectorsRaw, true);
emit('expected.json', JSON.stringify(expected) + '\n', true);
source('shared/tokenizer/generate.mjs'); source('node_modules/esbuild/package.json'); source('package-lock.json');
const provenance = JSON.stringify({ purpose: 'Fixed offline WK execution of the actual Web cl100k tokenizer worker; provider counts remain observed counts', version: metadata.version,
  officialSource: { fileHashes: officialFiles, npm: 'https://registry.npmjs.org/@dqbd/tiktoken/1.0.2', integrity: 'sha512-AjGTBRWsMoVmVeN55NLyupyM8TNamOUBl6tj5t/leLDVup3CFGO9tVagNL1jf3GyZLkWZSTmYVbPQ/M2LEcNzw==',
    gitHead: '68efa86723b67247a039548f03fa2286dfcf030a', license: 'https://raw.githubusercontent.com/dqbd/tiktoken/68efa86723b67247a039548f03fa2286dfcf030a/LICENSE' },
  inputs, assets, fixtureAssets, totalAssetBytes: Object.values(assets).reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2) + '\n';
const manifest = path.join(output, 'provenance.json');
if (check) { if (readFileSync(manifest, 'utf8') !== provenance) throw Error('Stale tokenizer provenance'); }
else writeFileSync(manifest, provenance);
console.log(JSON.stringify({ totalAssetBytes: Object.values(assets).reduce((sum, asset) => sum + asset.bytes, 0), vectors: expected }));
