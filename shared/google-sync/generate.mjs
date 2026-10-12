import { build, version as esbuildVersion } from 'esbuild';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const check = process.argv[2] === '--check';
const webRoot = path.resolve(process.argv[check ? 3 : 2] ?? path.join(root, '../..'));
if (check) {
  const provenance = JSON.parse(readFileSync(path.join(root, 'provenance.json'), 'utf8'));
  for (const [filename, expected] of Object.entries(provenance.inputs)) {
    const actual = createHash('sha256').update(readFileSync(path.join(webRoot, filename))).digest('hex');
    if (actual !== expected) throw new Error(`Stale native sync bundle input: ${filename}. Regenerate and run the affected exchange cases.`);
  }
  for (const [filename, expected] of Object.entries(provenance.bundleInputs)) {
    const actual = createHash('sha256').update(readFileSync(path.join(root, '../..', filename))).digest('hex');
    if (actual !== expected) throw new Error(`Stale native sync bundle adapter/input: ${filename}. Regenerate it.`);
  }
  for (const [filename, expected] of Object.entries(provenance.dependencyInputs ?? {})) {
    const actual = createHash('sha256').update(readFileSync(path.join(root, '../../node_modules', filename))).digest('hex');
    if (actual !== expected) throw new Error(`Native sync dependency changed: ${filename}. Regenerate it.`);
  }
  if (provenance.generator.esbuild !== esbuildVersion || provenance.generator.typescript !== ts.version) {
    throw new Error('Native sync generator dependency versions changed. Regenerate it.');
  }
  const actualBundle = createHash('sha256').update(readFileSync(path.join(root, 'GoogleSync.bundle.js'))).digest('hex');
  if (actualBundle !== provenance.bundleSHA256) throw new Error('Native sync bundle differs from the generated artifact. Regenerate it.');
  console.log('Native sync bundle Web input hashes and artifact hash match.');
  process.exit(0);
}
const sourceNames = ['sync', 'replay', 'merge', 'mergeBranches', 'records', 'decodeParts', 'crypto'];
const inputs = {};
for (const name of sourceNames) {
  const input = `src/store/storage/google/${name}.ts`;
  copyFileSync(path.join(webRoot, input), path.join(root, 'source', `${name}.ts`));
  inputs[input] = createHash('sha256').update(readFileSync(path.join(webRoot, input))).digest('hex');
}
// Export the existing private helpers for the native bridge without copying their logic.
const recordsSnapshot = path.join(root, 'source/records.ts');
writeFileSync(recordsSnapshot, readFileSync(recordsSnapshot, 'utf8') + '\nexport { canonical };\n');
writeFileSync(path.join(root, 'provenance.json'), JSON.stringify({
  sourceOfTruth: 'Current repository Web source; source/ is a generated audit snapshot, never hand-edit it.',
  license: 'Repository CC0 1.0; see LICENSE.txt',
  regenerate: 'node shared/google-sync/generate.mjs [Web repository root]',
  checkFreshness: 'node shared/google-sync/generate.mjs --check [Web repository root]',
  generator: { esbuild: esbuildVersion, typescript: ts.version },
  freshness: 'Regenerate after Web changes; compare inputs hashes with current source. Commit protocol/merge tests must pass on both platforms.',
  inputs,
}, null, 2) + '\n');
const adapters = new Set(['crypto', 'cache', 'diagnostics', 'progress', 'processing', 'metrics', 'conflicts', 'transport']);
const bundled = await build({ metafile: true, entryPoints: [path.join(root, 'entry.ts')], outfile: path.join(root, 'GoogleSync.bundle.js'), bundle: true,
  format: 'iife', globalName: 'WeaveletGoogleSync', target: 'es2022', legalComments: 'inline',
  plugins: [{ name: 'native-boundaries', setup(build) {
    build.onResolve({ filter: /^uuid$/ }, () => ({ path: path.join(root, 'adapters/uuid.ts') }));
    build.onResolve({ filter: /^\.\.\/sync\/EncryptedSync$/ }, () => ({ path: path.join(webRoot, 'src/store/storage/sync/EncryptedSync.ts') }));
    build.onResolve({ filter: /^\.\.\/google\// }, args => {
      const name = args.path.slice('../google/'.length);
      if (adapters.has(name)) return { path: path.join(root, 'adapters', `${name}.ts`) };
      if (sourceNames.includes(name)) return { path: path.join(root, 'source', `${name}.ts`) };
    });
    build.onResolve({ filter: /^\.\// }, args => {
      const name = args.path.slice(2);
      if (args.importer === path.join(webRoot, 'src/store/storage/sync/EncryptedSync.ts') && name === 'transport') return { path: path.join(root, 'adapters/transport.ts') };
      const googleModule = args.importer.startsWith(path.join(root, 'source')) || args.importer.startsWith(path.join(webRoot, 'src/store/storage/google'));
      if (googleModule && adapters.has(name)) return { path: path.join(root, 'adapters', `${name}.ts`) };
      if (googleModule && sourceNames.includes(name)) return { path: path.join(root, 'source', `${name}.ts`) };
      if (args.importer.startsWith(path.join(root, 'source')) && existsSync(path.join(webRoot, 'src/store/storage/google', `${name}.ts`))) return { path: path.join(webRoot, 'src/store/storage/google', `${name}.ts`) };
    });
    build.onResolve({ filter: /^@(utils|store|type)\// }, args => {
      const [, category, name] = args.path.match(/^@(utils|store|type)\/(.*)$/);
      return { path: path.join(webRoot, 'src', category === 'type' ? 'types' : category, name + '.ts') };
    });
    build.onResolve({ filter: /^\.\.\/\.\.\/src\/utils\/chatFolders$/ }, () => ({ path: path.join(webRoot, 'src/utils/chatFolders.ts') }));
  } }] });

for (const filename of Object.keys(bundled.metafile.inputs)) {
  const input = path.resolve(filename);
  if (input.startsWith(webRoot + path.sep) && !input.startsWith(root + path.sep) && !input.includes('/node_modules/')) {
    inputs[path.relative(webRoot, input)] = createHash('sha256').update(readFileSync(input)).digest('hex');
  }
}
const provenance = JSON.parse(readFileSync(path.join(root, 'provenance.json'), 'utf8'));
provenance.inputs = inputs;
provenance.bundleInputs = {};
for (const filename of [...Object.keys(bundled.metafile.inputs), path.join(root, 'generate.mjs')]) {
  const input = path.resolve(filename);
  if (input.startsWith(root + path.sep) || input.startsWith(path.resolve(root, '../../src') + path.sep)) {
    provenance.bundleInputs[path.relative(path.join(root, '../..'), input)] = createHash('sha256').update(readFileSync(input)).digest('hex');
  }
}
provenance.dependencyInputs = {};
const packages = new Set();
for (const filename of Object.keys(bundled.metafile.inputs)) {
  const input = path.resolve(filename);
  const marker = '/node_modules/';
  if (!input.includes(marker)) continue;
  const relative = input.slice(input.lastIndexOf(marker) + marker.length);
  provenance.dependencyInputs[relative] = createHash('sha256').update(readFileSync(input)).digest('hex');
  const parts = relative.split('/');
  packages.add(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
}
const licenses = [];
mkdirSync(path.join(root, 'licenses'), { recursive: true });
for (const pkg of [...packages].sort()) {
  for (const name of ['package.json', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    const relative = `${pkg}/${name}`;
    const file = path.join(root, '../../node_modules', relative);
    if (!existsSync(file)) continue;
    provenance.dependencyInputs[relative] = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (name === 'package.json') continue;
    const license = readFileSync(file, 'utf8');
    writeFileSync(path.join(root, 'licenses', `${pkg.replaceAll('/', '-')}-${name}.txt`), license);
    licenses.push(`/* Dependency ${pkg}\n${license.replaceAll('*/', '* /')}\n*/`);
  }
}
writeFileSync(path.join(root, 'GoogleSync.bundle.js'), readFileSync(path.join(root, 'GoogleSync.bundle.js'), 'utf8') + '\n' + licenses.join('\n') + '\n');
provenance.bundleSHA256 = createHash("sha256").update(readFileSync(path.join(root, "GoogleSync.bundle.js"))).digest("hex");
writeFileSync(path.join(root, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
