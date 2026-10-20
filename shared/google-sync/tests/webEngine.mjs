import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function engine(webRoot) {
  copyFileSync(path.join(webRoot, 'src/store/storage/google/crypto.ts'), path.join(root, 'source/crypto.ts'));
  const output = '/private/tmp/weavelet-web-sync-reference.mjs';
  const adapters = new Set(['diagnostics', 'progress', 'metrics', 'conflicts', 'transport']);
  await build({ entryPoints: [path.join(root, 'tests/webEntry.ts')], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    plugins: [{ name: 'fake-drive-boundaries', setup(build) {
      build.onResolve({ filter: /^\.\.\/sync\/EncryptedSync$/ }, () => ({ path: path.join(webRoot, 'src/store/storage/sync/EncryptedSync.ts') }));
      build.onResolve({ filter: /^\.\/transport$/ }, args => {
        if (args.importer === path.join(webRoot, 'src/store/storage/sync/EncryptedSync.ts')) return { path: path.join(root, 'adapters/transport.ts') };
      });
      build.onResolve({ filter: /^(\.\/|\.\.\/google\/)/ }, args => {
        const name = args.path.replace(/^(\.\/|\.\.\/google\/)/, '');
        if (!args.importer.startsWith(path.join(root, 'source')) && !args.importer.startsWith(path.join(webRoot, 'src/store/storage'))) return;
        if (name === 'processing' || name === 'cache') return { path: path.join(root, 'tests', name === 'processing' ? 'webProcessing.ts' : 'webCache.ts') };
        if (adapters.has(name)) return { path: path.join(root, 'adapters', `${name}.ts`) };
        if (existsSync(path.join(root, 'source', `${name}.ts`))) return { path: path.join(root, 'source', `${name}.ts`) };
        if (existsSync(path.join(webRoot, 'src/store/storage/google', `${name}.ts`))) return { path: path.join(webRoot, 'src/store/storage/google', `${name}.ts`) };
      });
      build.onResolve({ filter: /^@(utils|store|type)\// }, args => {
      const [, category, name] = args.path.match(/^@(utils|store|type)\/(.*)$/);
      return { path: path.join(webRoot, 'src', category === 'type' ? 'types' : category, name + '.ts') };
    });
    } }] });
  if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  return import(pathToFileURL(output).href + '?run=' + Date.now());
}
