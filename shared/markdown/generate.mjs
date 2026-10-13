import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'shared/markdown');
const output = path.join(directory, 'resources');
const check = process.argv.includes('--check');
const emit = (name, value) => {
  const destination = path.join(output, name);
  if (check) { if (!readFileSync(destination).equals(Buffer.from(value))) throw Error(`Stale Markdown resource: ${name}`); }
  else { mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, value); }
};
const config = JSON.parse(readFileSync(path.join(root, 'tsconfig.json')));
const alias = Object.fromEntries(Object.entries(config.compilerOptions.paths).map(([key, [value]]) =>
  [key.replace('/*', ''), path.resolve(root, value.replace('/*', ''))]));
const bundle = await build({ entryPoints: [path.join(directory, 'host.tsx')], alias,
  bundle: true, format: 'iife', platform: 'browser', minify: true, write: false, metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' } });
emit('markdown.js', bundle.outputFiles[0].contents);
const css = readFileSync(path.join(root, 'src/main.css'), 'utf8').replace('@import url(Roboto.css);', '');
const tailwindConfig = require(path.join(root, 'tailwind.config.cjs'));
const content = ['src/components/Chat/ChatContent/Message/View/{ContentBody,MarkdownRenderer}.tsx',
  'src/components/Chat/ChatContent/Message/CodeBlock.tsx'].map(name => path.join(root, name));
const styles = await postcss([tailwind({ ...tailwindConfig, content }), autoprefixer]).process(css, { from: path.join(root, 'src/main.css') });
const katexDirectory = path.dirname(require.resolve('katex/dist/katex.min.css'));
emit('markdown.css', styles.css + '\n' + readFileSync(path.join(katexDirectory, 'katex.min.css'), 'utf8') + '\n' + readFileSync(path.join(directory, 'host.css'), 'utf8'));
for (const name of readdirSync(path.join(katexDirectory, 'fonts'))) emit(`fonts/${name}`, readFileSync(path.join(katexDirectory, 'fonts', name)));
emit('index.html', readFileSync(path.join(directory, 'index.html')));
const sources = [...Object.keys(bundle.metafile.inputs).map(name => path.resolve(root, name)),
  path.join(root, 'src/main.css'), path.join(root, 'tailwind.config.cjs'), path.join(directory, 'host.css'), path.join(directory, 'index.html'), fileURLToPath(import.meta.url)];
// Keep nested package paths: their version and license may differ from the root copy.
const packages = new Map();
const addPackage = base => {
  const metadata = JSON.parse(readFileSync(path.join(base, 'package.json'), 'utf8'));
  packages.set(base, metadata);
};
for (const pkg of ['katex', 'tailwindcss', '@tailwindcss/typography', 'postcss', 'autoprefixer']) addPackage(path.join(root, 'node_modules', pkg));
for (const filename of sources) {
  const marker = '/node_modules/';
  const index = filename.lastIndexOf(marker);
  if (index < 0) continue;
  const parts = filename.slice(index + marker.length).split('/');
  const pkg = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  addPackage(path.join(filename.slice(0, index + marker.length), pkg));
}
const supplementalPath = path.join(directory, 'licenses/sources.json');
const supplemental = JSON.parse(readFileSync(supplementalPath, 'utf8'));
sources.push(supplementalPath);
const notices = [];
for (const [base, metadata] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = metadata.name;
  const files = readdirSync(base).filter(name => ['package.json', 'license', 'license.md', 'license.txt'].includes(name.toLowerCase())).sort();
  for (const name of files) {
    const file = path.join(base, name);
    sources.push(file);
    if (name !== 'package.json') notices.push(`Dependency: ${pkg}@${metadata.version} (${name})
${readFileSync(file, 'utf8')}`);
  }
  if (!files.some(name => name !== 'package.json')) {
    const extra = supplemental[pkg];
    if (!extra || extra.version !== metadata.version) throw Error(`Missing fixed-version Markdown license: ${pkg}@${metadata.version}`);
    const file = path.join(directory, 'licenses', extra.file);
    sources.push(file);
    notices.push(`Dependency: ${pkg} (${metadata.version}, supplemental license)
Source: ${extra.source}
${extra.termsSource ? `MIT terms: ${extra.termsSource}\n` : ''}${readFileSync(file, 'utf8')}`);
  }
}
emit('NOTICE.txt', notices.join('\n\n').trimEnd() + '\n');
const hashes = Object.fromEntries(sources.sort().map(filename => [path.relative(root, filename), createHash('sha256').update(readFileSync(filename)).digest('hex')]));
emit('sources.json', JSON.stringify(hashes, null, 2) + '\n');
