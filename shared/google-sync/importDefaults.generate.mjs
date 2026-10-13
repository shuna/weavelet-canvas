import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function generateImportDefaults(webRoot, destination, check) {
  const config = JSON.parse(readFileSync(path.join(webRoot, 'tsconfig.json'), 'utf8'));
  const alias = Object.fromEntries(Object.entries(config.compilerOptions.paths).map(([key, [value]]) =>
    [key.replace('/*', ''), path.resolve(webRoot, value.replace('/*', ''))]));
  const result = await build({
    stdin: { contents: "import useStore,{createPartializedState} from './src/store/store'; const state=createPartializedState(useStore.getInitialState()); export const defaults={keys:Object.keys(state),values:state};", resolveDir: webRoot, loader: 'ts' },
    alias, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, metafile: true,
    // Never embed a build machine's credentials or deployment-specific overrides.
    define: { 'import.meta.env': '{}', 'import.meta.url': '"about:blank"' },
    plugins: [{ name: 'initial-state-storage', setup(builder) {
      builder.onResolve({ filter: /CompressedStorage$/ }, () => ({ path: 'storage', namespace: 'initial-state' }));
      builder.onLoad({ filter: /.*/, namespace: 'initial-state' }, () => ({
        contents: 'export default {getItem(){return null},setItem(){throw Error("Unexpected initial-state write")},removeItem(){throw Error("Unexpected initial-state write")}}', loader: 'js',
      }));
    } }],
  });
  // Store initialization may register timers. A disposable process takes the synchronous
  // getInitialState result and exits without running those browser lifecycle callbacks.
  const runner = `const vm=require('node:vm');const moduleState={exports:{}};vm.runInNewContext(${JSON.stringify(result.outputFiles[0].text)},{module:moduleState,exports:moduleState.exports,require,console,setTimeout,clearTimeout,URL,TextEncoder,TextDecoder},{timeout:10000});process.stdout.write(JSON.stringify(moduleState.exports.defaults));process.exit(0);`;
  const child = spawnSync(process.execPath, [], { input: runner, cwd: webRoot, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw child.error ?? new Error(child.stderr);
  const defaults = JSON.parse(child.stdout);
  if (defaults.values.apiKey !== undefined || defaults.values.proxyAuthToken) throw new Error('Credentials in native import defaults');
  const text = JSON.stringify(defaults, null, 2) + '\n';
  if (check) {
    if (readFileSync(destination, 'utf8') !== text) throw new Error('Stale Web import initial state. Regenerate the native bundle.');
  } else writeFileSync(destination, text);
  return Object.fromEntries(Object.keys(result.metafile.inputs).filter(filename => !filename.startsWith("<") && !filename.startsWith("initial-state:")).map(filename => path.resolve(filename))
    .filter(filename => filename.startsWith(webRoot + path.sep) && !filename.includes('/node_modules/'))
    .map(filename => [path.relative(webRoot, filename), createHash('sha256').update(readFileSync(filename)).digest('hex')]));
}
