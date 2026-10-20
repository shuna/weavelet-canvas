import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { transform } from 'esbuild';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'weavelet-zstd-test-'));
const originalFetch = globalThis.fetch;
const wasm = await readFile(join(root, 'zstd.wasm'));
const body = await readFile(new URL('./body.json', import.meta.url));
const frame = await readFile(new URL('./body.zst', import.meta.url));
const unknown = await readFile(new URL('./unknown-size.zst', import.meta.url));
const empty = await readFile(new URL('./empty.zst', import.meta.url));
const oldContainer = await readFile(new URL('../../../tests/fixtures/web-native/legacy-ios-sync-snapshot.wvlt', import.meta.url));
const oldExpected = JSON.parse(await readFile(new URL('../../../tests/fixtures/web-native/legacy-ios-sync-snapshot.json', import.meta.url), 'utf8'));
const oldPayload = oldContainer.subarray(20), oldSize = oldContainer.readUInt32LE(8);
const moduleSource = (await transform(await readFile(join(root, 'index.ts'), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2020' })).code;
const corrupted = Buffer.from(frame); corrupted[corrupted.length - 1] ^= 1;
const cases = [
  ['known size', frame, body.length, body], ['unknown size', unknown, body.length, body], ['empty output', empty, 0, Buffer.alloc(0)],
  ['bad checksum', corrupted, body.length], ['truncated', frame.subarray(0, -1), body.length],
  ['trailing byte', Buffer.concat([frame, Buffer.from([0])]), body.length],
  ['second frame', Buffer.concat([frame, frame]), body.length],
  ['declared size mismatch', frame, body.length + 1], ['bounded unknown size', unknown, body.length - 1],
  ['actual unknown size mismatch', unknown, body.length + 1], ['negative size', frame, -1],
  ['noninteger size', frame, 1.5], ['size limit', frame, 128 * 1024 * 1024 + 1], ['invalid magic', Buffer.from([0, 0, 0, 0]), 0],
];
let server;
try {
  await writeFile(join(temp, 'index.mjs'), moduleSource);
  await cp(join(root, 'zstd.wasm'), join(temp, 'zstd.wasm'));
  let loads = 0;
  globalThis.fetch = async (url, ...args) => {
    if (url instanceof URL && url.protocol === 'file:') { loads++; return new Response(await readFile(url)); }
    return originalFetch(url, ...args);
  };
  const { decompressZstd } = await import(pathToFileURL(join(temp, 'index.mjs')));
  for (const [name, input, size, expected] of cases) {
    if (expected) assert.deepEqual(Buffer.from(await decompressZstd(input, size)), expected, name);
    else await assert.rejects(decompressZstd(input, size), undefined, name);
  }
  await assert.rejects(decompressZstd(new Uint8Array(128 * 1024 * 1024 + 1), 1), /input exceeds/);
  assert.deepEqual(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decompressZstd(oldPayload, oldSize))), oldExpected);
  console.log('Node: actual old iOS 1.5.6 writer payload decoded to its exact JSON object');
  assert.equal(loads, 1, 'one lazy WASM load');
  await Promise.all(Array.from({ length: 5 }, async () => assert.deepEqual(Buffer.from(await decompressZstd(frame, body.length)), body)));
  console.log(`Node: ${cases.length} frame/limit cases, concurrent reuse and one lazy WASM load passed`);
  globalThis.fetch = originalFetch;

  execFileSync('clang', ['-O2', join(root, 'zstddeclib.c'), join(root, 'tests/native.c'), '-o', join(temp, 'native')]);
  for (const file of ['body.zst', 'unknown-size.zst']) {
    process.stdout.write(execFileSync(join(temp, 'native'), [join(root, 'tests', file), join(root, 'tests/body.json')]));
  }
  server = createServer((request, response) => {
    if (request.url === '/index.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(moduleSource); }
    else if (request.url === '/zstd.wasm') { response.setHeader('Content-Type', 'application/wasm'); response.end(wasm); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Zstandard decoder test</title>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const engine of [chromium]) {
    const browser = await engine.launch({ headless: true, ...(process.env.ZSTD_BROWSER_CHANNEL ? { channel: process.env.ZSTD_BROWSER_CHANNEL } : {}) });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const results = await page.evaluate(async vectors => {
        const { decompressZstd } = await import('/index.js');
        return Promise.all(vectors.map(async ([name, bytes, size, expected]) => {
          try {
            const result = await decompressZstd(new Uint8Array(bytes), size);
            return [name, expected !== null && JSON.stringify([...result]) === JSON.stringify(expected)];
          } catch { return [name, expected === null]; }
        }));
      }, cases.map(([name, bytes, size, expected]) => [name, [...bytes], size, expected ? [...expected] : null]));
      for (const [name, passed] of results) assert.ok(passed, `${engine.name()}: ${name}`);
      const oldResult = await page.evaluate(async ({ bytes, size }) => {
        const { decompressZstd } = await import('/index.js');
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decompressZstd(new Uint8Array(bytes), size)));
      }, { bytes: [...oldPayload], size: oldSize });
      assert.deepEqual(oldResult, oldExpected);
      console.log(`${engine.name()}: ${cases.length} actual browser decode/rejection cases and old iOS writer payload passed`);
    } finally { await browser.close(); }
  }
} finally {
  globalThis.fetch = originalFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
