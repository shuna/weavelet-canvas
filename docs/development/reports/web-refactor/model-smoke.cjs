// Dedicated browser profile and a caller-supplied, pinned local model file.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
(async () => {
  const base = process.argv[2];
  const model = process.argv[3];
  const output = process.argv[4];
  if (!base || !model || !output) throw Error('Usage: model-smoke.cjs BASE_URL MODEL_GGUF OUTPUT_JSON');
  const files = http.createServer((_req, res) => {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Length': fs.statSync(model).size });
    fs.createReadStream(model).pipe(res);
  });
  await new Promise(resolve => files.listen(0, '127.0.0.1', resolve));
  const modelUrl = `http://127.0.0.1:${files.address().port}/model.gguf`;
  const server = await chromium.launchServer({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--unlimited-storage'] });
  const browser = await chromium.connect(server.wsEndpoint());
  const deadline = setTimeout(() => { void server.close(); }, 180000);
  let peakRssKiB = 0;
  const sample = () => {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const ids = new Set([server.process().pid]);
    let previous;
    do { previous = ids.size; for (const [id,parent] of rows) if (ids.has(parent)) ids.add(id); } while (ids.size !== previous);
    const rss = rows.reduce((sum,[id,,memory]) => sum + (ids.has(id) ? memory : 0), 0);
    peakRssKiB = Math.max(peakRssKiB,rss);
  };
  const timer = setInterval(sample, 250);
  try {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const result = await page.evaluate(async (modelUrl) => {
      const load = path => import(path);
      const storage = await load('/src/local-llm/storage.ts');
      const { localModelRuntime: runtime } = await load('/src/local-llm/runtime.ts');
      const id = 'smollm2-360m-instruct-q8';
      const name = 'smollm2-360m-instruct-q8_0.gguf';
      const file = await (await fetch(modelUrl)).blob();
      await storage.saveFile(id, name, file);
      const definition = { id, engine: 'wllama', tasks: ['generation'], label: id, origin: 'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF', source: 'opfs', manifest: { kind: 'single-file', entrypoint: name }, fileSize: file.size };
      const started = performance.now();
      await runtime.loadModel(definition, { source: 'opfs', dispose() {} }, { forceDisableWebGPU: true });
      const loadMs = performance.now() - started;
      const engine = runtime.getWllamaEngine(id);
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now(); let first;
        const text = await engine.generate({ messages: [{role:'user',content:'What is 2 + 3? Answer briefly.'}] }, {maxTokens:32,temperature:0}, () => { first ??= performance.now(); });
        if (!text.trim()) throw Error('Empty model output');
        runs.push({ ttftMs: first - start, durationMs: performance.now() - start, text });
      }
      let reservationResult;
      if (runtime.reserve) {
        runtime.reserve('smoke-owner', [id]);
        reservationResult = await runtime.unloadModel(id);
        if (reservationResult !== 'reserved' || !runtime.isLoaded(id)) throw Error('Reserved model was unloaded');
        runtime.release('smoke-owner');
      }
      const controller = new AbortController();
      const supportsSignal = typeof runtime.reserve === 'function';
      let cancelAt;
      let cancellationError;
      const cancelled = await engine.generate({ messages: [{role:'user',content:'Count upward from one to one hundred.'}] }, {maxTokens:1024,temperature:0}, () => {
        if (cancelAt === undefined) { cancelAt = performance.now(); if (supportsSignal) controller.abort(); else engine.abort(); }
      }, 'test', controller.signal).catch(error => { if (error.name !== 'AbortError') throw error; cancellationError = error.name; return ''; });
      const cancelMs = performance.now() - cancelAt;
      if (cancelAt === undefined) throw Error('Cancellation path did not receive a chunk');
      await runtime.unloadModel(id);
      const loadedAfterUnload = runtime.isLoaded(id);
      let deletionError, assetRemovalStatus;
      if (supportsSignal) {
        const { removeAssets } = await load('/src/local-llm/assetRemoval.ts');
        const removed = await removeAssets(id);
        assetRemovalStatus = removed.status;
        const present = (await storage.listSavedModelIds()).includes(id);
        if ((removed.status === 'removed') === present) throw Error('Asset removal status does not match OPFS');
      } else {
        try { await storage.deleteModel(id); } catch (error) { deletionError = String(error); }
      }
      if (loadedAfterUnload) throw Error('Model still loaded after unload');
      return { browser: navigator.userAgent, modelBytes: file.size, loadMs, runs, reservationResult, cancelMechanism: supportsSignal ? 'signal' : 'engine.abort', cancelMs, cancellationError, cancelledText: cancelled, loadedAfterUnload, deletionError, assetRemovalStatus };
    }, modelUrl);
    sample();
    fs.writeFileSync(output, JSON.stringify({ ...result, peakBrowserTreeRssKiB: peakRssKiB, rssNote: '250ms sum of browser descendant RSS; shared pages may be counted more than once.' }, null, 2)+'\n');
    console.log(JSON.stringify(result));
  } finally { clearInterval(timer); clearTimeout(deadline); await browser.close(); await server.close(); files.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
