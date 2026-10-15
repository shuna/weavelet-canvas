import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Synthetic data only. Usage: node scripts/benchmark-browser-compression.mjs [--smoke] [--native-only] [--incompressible] [--report=path]
const smoke = process.argv.includes('--smoke');
const nativeOnly = process.argv.includes('--native-only');
const incompressible = process.argv.includes('--incompressible');
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9) ??
  `docs/development/reports/browser-compression${incompressible ? '-incompressible' : ''}${smoke ? '-smoke' : ''}.json`;
const origin = process.env.WEAVELET_TEST_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  // A blank same-origin page avoids app bootstrap, storage access and unrelated work during the measurement.
  await page.route('**/__compression-benchmark__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic compression benchmark</title>' }));
  await page.goto(`${origin}/__compression-benchmark__`);
  await page.exposeFunction('benchmarkProgress', value => console.log(JSON.stringify(value)));
  const result = await page.evaluate(async ({ smoke, nativeOnly, incompressible }) => {
    const { createSyntheticSnapshot, SYNTHETIC_PROFILE } = await import('/src/store/storage/google/synthetic.ts');
    const lz = (await import('/node_modules/.vite/deps/lz-string.js')).default;
    const progress = value => window.benchmarkProgress(value);
    const report = { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, cases: [] };
    const cases = smoke ? [{ name: 'smoke', options: { bodyBytes: 128, profile: {
      treeChats: 2, treeNodes: 20, legacyChats: 10, legacyNodes: 100,
      maxTreeNodes: 10, maxDepth: 5, maxFanout: 4, targetJsonBytes: 0,
    } } }] : [{ name: 'scale1', options: { scale: 1, bodyBytes: 5300 } },
      { name: 'scale3', options: { scale: 3, bodyBytes: 5300 } }];
    for (const testCase of cases) {
      testCase.options.incompressible = incompressible;
      await progress({ case: testCase.name, phase: 'generate', incompressible });
      let started = performance.now();
      const snapshot = createSyntheticSnapshot(testCase.options);
      const generationMs = performance.now() - started;
      started = performance.now();
      const json = JSON.stringify(snapshot);
      const serializeMs = performance.now() - started;
      const inputBytes = new TextEncoder().encode(json).length;
      const row = { name: testCase.name, options: testCase.options, profile: testCase.options.profile ?? SYNTHETIC_PROFILE,
        generationMs, serializeMs, inputBytes, measurements: [] };
      const formats = [...(!nativeOnly && testCase.name !== 'scale3' ? ['lz-string'] : []), 'gzip', 'deflate-raw', 'brotli'];
      for (const format of formats) {
        await progress({ case: row.name, format, phase: 'compress', inputBytes });
        let compressed;
        started = performance.now();
        if (format === 'lz-string') compressed = lz.compressToUint8Array(json);
        else {
          try { new CompressionStream(format); new DecompressionStream(format); }
          catch {
            const unsupported = { format, supported: false };
            row.measurements.push(unsupported); await progress({ case: row.name, ...unsupported }); continue;
          }
          // Include UTF-8 encoding, Blob/stream setup and output collection in native timings.
          compressed = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream(format))).arrayBuffer());
        }
        const compressMs = performance.now() - started;
        await progress({ case: row.name, format, phase: 'decompress', outputBytes: compressed.length, compressMs });
        started = performance.now();
        const restored = format === 'lz-string' ? lz.decompressFromUint8Array(compressed) :
          new TextDecoder('utf-8', { fatal: true }).decode(await new Response(
            new Blob([compressed]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer());
        const decompressMs = performance.now() - started;
        const roundtrip = restored === json;
        if (!roundtrip) throw new Error(`${row.name}/${format}: roundtrip failed`);
        const measurement = { format, supported: true, compressMs, decompressMs,
          compressedBytes: compressed.length, ratio: compressed.length / inputBytes, roundtrip };
        row.measurements.push(measurement);
        await progress({ case: row.name, ...measurement });
      }
      report.cases.push(row);
    }
    return report;
  }, { smoke, nativeOnly, incompressible });
  const report = { createdAt: new Date().toISOString(), browser: await browser.version(), ...result,
    concurrentWorkload: process.env.BENCH_CONCURRENT_WORKLOAD ?? 'Not controlled; background system load may be present.',
    limitations: [
      'Synthetic text only; no personal exports were loaded or inspected.',
      'Random text is a contrasting compression scenario; neither synthetic scenario estimates the personal export compression ratio.',
      'One run per case/format; timings are indicative, not statistical distributions.',
      'Concurrent system workload is not controlled; timings may reflect CPU/resource contention.',
      'Native compression means the browser CompressionStream API; hardware acceleration is not established.',
      'Compression input is pre-serialized JSON. Native timings include UTF-8/stream copies; LZ works on UTF-16 strings.',
      'This isolates codecs; it does not include sync, network, encryption, IndexedDB or Worker overhead.',
      'No reliable peak memory measurement was collected.',
    ] };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: reportPath, complete: true }));
} finally { await browser.close(); }
