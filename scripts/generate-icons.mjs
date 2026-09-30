import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const sourceSvg = path.join(publicDir, 'weavelet-canvas-icon.svg');
const pwaSvg = path.join(publicDir, 'weavelet-canvas-pwa-icon.svg');
const templateSvg = path.join(publicDir, 'weavelet-canvas-icon-template.svg');

const background = 'x="72" y="72" width="880" height="880" rx="248"';
writeFileSync(pwaSvg, readFileSync(sourceSvg, 'utf8').replaceAll(background, 'x="0" y="0" width="1024" height="1024"'));

const rasterTargets = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['favicon-192x192.png', 192],
  ['favicon-512x512.png', 512],
  ['apple-touch-icon.png', 180],
  ['icon-rounded.png', 1024],
  ['icon-rounded-macos.png', 1024],
];

const templateTargets = [
  ['iconTemplate.png', 16],
  ['iconTemplate@2x.png', 32],
  ['iconTemplate@3x.png', 64],
];
const pwaTargets = new Set(['favicon-192x192.png', 'favicon-512x512.png', 'apple-touch-icon.png']);

const render = (input, output, size) => {
  execFileSync(
    'sips',
    ['-s', 'format', 'png', '-z', String(size), String(size), input, '--out', output],
    { stdio: 'inherit' }
  );
};

for (const [filename, size] of rasterTargets) {
  render(pwaTargets.has(filename) ? pwaSvg : sourceSvg, path.join(publicDir, filename), size);
}

for (const [filename, size] of templateTargets) {
  render(templateSvg, path.join(publicDir, filename), size);
}

execFileSync(
  'sips',
  ['-s', 'format', 'ico', '-z', '64', '64', sourceSvg, '--out', path.join(publicDir, 'favicon.ico')],
  { stdio: 'inherit' }
);
