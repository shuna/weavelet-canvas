import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Synthetic data only. Run each scale in a separate browser/process.
// node scripts/benchmark-browser-sync.mjs --scale=1 --report=path [--smoke]
const smoke = process.argv.includes('--smoke');
const scale = Number(process.argv.find(arg => arg.startsWith('--scale='))?.slice(8) ?? 1);
const bodyBytes = Number(process.env.SYNC_SCALE_BENCH_BODY_BYTES ?? (smoke ? 256 : 5300));
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9) ??
  `docs/development/reports/browser-sync-scale${scale}${smoke ? '-smoke' : ''}.json`;
const origin = process.env.WEAVELET_TEST_URL ?? 'http://127.0.0.1:5175';
const report = { createdAt: new Date().toISOString(), scale, bodyBytes, smoke, complete: false,
  concurrentBenchmarkLoad: process.env.SYNC_BENCH_CONCURRENT_LOAD === '1',
  limitations: ['Synthetic text only; no personal exports read.',
    'Repeated fictional text is highly compressible; matching node/JSON sizes does not reproduce the export compression ratio.',
    'Real Chrome Worker and IndexedDB, zero-latency mock network; no Google Drive traffic.',
    'restartPull recreates the Engine and reads real IndexedDB in the same page; the Worker/browser process stays alive.',
    'One sample; CPU contention and garbage collection affect timings.',
    'JS heap readings exclude reliable process/Worker peak memory measurement.'], scenarios: {} };
await mkdir(dirname(reportPath), { recursive: true });
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  report.browser = await browser.version();
  const cdp = await browser.newBrowserCDPSession();
  report.browserProcessIds = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(({ type, id }) => ({ type, id }));
  await cdp.detach();
  const page = await browser.newPage();
  await page.route('**/__sync-benchmark__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic sync benchmark</title>' }));
  await page.goto(`${origin}/__sync-benchmark__`);
  await page.exposeFunction('benchmarkProgress', async value => {
    if (value.scenario) report.scenarios[value.scenario] = value.measurement;
    else if (value.summary) Object.assign(report, value.summary);
    await save();
    console.log(JSON.stringify(value));
  });
  const summary = await page.evaluate(async ({ scale, bodyBytes, smoke }) => {
    const { createSyntheticSnapshot, SYNTHETIC_PROFILE } = await import('/src/store/storage/google/synthetic.ts');
    const { EncryptedSync } = await import('/src/store/storage/sync/EncryptedSync.ts');
    const { resetSyncMetrics, getSyncMetrics } = await import('/src/store/storage/google/metrics.ts');
    const { addContent, addContentDelta, resolveContentStrict } = await import('/src/utils/contentStore.ts');
    const { readSyncEntries } = await import('/src/store/storage/google/cache.ts');
    let workerCreations = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); workerCreations++; } };
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const progress = value => window.benchmarkProgress(value);
    let next = 0, uploadedBytes = 0, downloadedBytes = 0, calls = {};
    const headers = new Map(), files = new Map(), events = [];
    const count = method => { calls[method] = (calls[method] ?? 0) + 1; };
    const list = (dataset, kind) => [...files].filter(([, f]) => f.dataset === dataset && f.kind === kind).map(([id]) => id);
    const transport = {
      async ids(countValue) { count('ids'); return Array.from({ length: countValue }, () => `synthetic-${++next}`); },
      async folder(id, header) { count('folder'); headers.set(id, header); return { id }; },
      async keyHeader(dataset) { count('keyHeader'); const header = headers.get(dataset); assert(header, 'Missing synthetic key header.'); return header; },
      async read(id) { count('read'); const file = files.get(id); assert(file, 'Missing synthetic file.'); downloadedBytes += file.bytes.length; return file.bytes.slice(); },
      async put(id, dataset, kind, bytes) {
        count('put'); uploadedBytes += bytes.length;
        const old = files.get(id);
        if (old) { assert(old.bytes.length === bytes.length && old.bytes.every((b, i) => b === bytes[i]), 'Immutable bytes changed.'); return; }
        files.set(id, { dataset, kind, bytes: bytes.slice() }); events.push({ id, dataset, kind });
      },
      async startToken() { count('startToken'); return String(events.length); },
      async history(dataset) { count('history'); return { commits: list(dataset, 'commit'), packs: list(dataset, 'pack') }; },
      async commits(dataset) { count('commits'); return list(dataset, 'commit'); },
      async packs(dataset) { count('packs'); return list(dataset, 'pack'); },
      async changes(token) { count('changes'); return { token: String(events.length), changes: events.slice(Number(token)) }; },
      async remove(id) { count('remove'); if (files.delete(id)) events.push({ id, removed: true }); },
    };
    const profile = smoke ? { ...SYNTHETIC_PROFILE, treeChats: 2, treeNodes: 24, legacyChats: 3,
      legacyNodes: 30, maxTreeNodes: 16, maxDepth: 6, maxFanout: 5 } : SYNTHETIC_PROFILE;
    await progress({ phase: 'generate', scale, bodyBytes });
    const generateStart = performance.now();
    let snapshot = createSyntheticSnapshot({ scale, bodyBytes, profile });
    const generationMs = performance.now() - generateStart;
    const inputBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    const expectedChats = (profile.treeChats + profile.legacyChats) * scale;
    const expectedNodes = (profile.treeNodes + profile.legacyNodes) * scale;
    await progress({ summary: { inputBytes, generationMs, chats: expectedChats, nodes: expectedNodes,
      userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency } });
    const validate = value => {
      assert(value.state.chats.length === expectedChats, 'Chat count changed.');
      assert(value.state.chats.reduce((n, c) => n + (c.branchTree ? Object.keys(c.branchTree.nodes).length : c.messages?.length ?? 0), 0) === expectedNodes, 'Node count changed.');
    };
    const password = 'synthetic browser benchmark password';
    let session, dataset;
    const measure = async (name, work) => {
      await progress({ phase: 'start', scenarioName: name });
      uploadedBytes = downloadedBytes = 0; calls = {}; resetSyncMetrics();
      const memoryBefore = performance.memory?.usedJSHeapSize;
      let lastTick = performance.now(), maxMainThreadLagMs = 0, heartbeatTicks = 0;
      const sampler = setInterval(() => {
        const now = performance.now(); maxMainThreadLagMs = Math.max(maxMainThreadLagMs, now - lastTick - 25);
        lastTick = now; heartbeatTicks++;
      }, 25);
      const started = performance.now();
      let received;
      try { received = await work(); } finally { clearInterval(sampler); }
      const ms = performance.now() - started;
      maxMainThreadLagMs = Math.max(maxMainThreadLagMs, performance.now() - lastTick - 25);
      const measurement = { ms, uploadedBytes, downloadedBytes, transportCalls: { ...calls },
        remoteStorageBytes: [...files.values()].reduce((n, file) => n + file.bytes.length, 0),
        workerCreations, metrics: getSyncMetrics(), memoryBefore, memoryAfter: performance.memory?.usedJSHeapSize,
        maxMainThreadLagMs, heartbeatTicks };
      validate(received); snapshot = received;
      // Probe real IDB outside the timed interval; avoids treating API presence as proof of storage use.
      assert((await readSyncEntries(dataset, ['replay']))[0] instanceof Uint8Array, 'Real replay cache was not persisted.');
      await progress({ scenario: name, measurement });
    };
    await measure('initial', async () => {
      const created = await EncryptedSync.create(transport, password);
      session = created.session; dataset = created.file.id;
      return session.synchronize(snapshot, true);
    });
    assert(workerCreations > 0, 'A real Worker was not created.');
    await measure('unchanged', () => session.synchronize(snapshot));
    const treeChat = () => snapshot.state.chats.find(c => c.branchTree);
    const firstNode = () => Object.values(treeChat().branchTree.nodes)[0];
    treeChat().title = 'Synthetic edited title';
    await measure('titleEdit', () => session.synchronize(snapshot));
    assert(treeChat().title === 'Synthetic edited title', 'Edited title changed.');
    const edited = structuredClone(resolveContentStrict(snapshot.state.contentStore, firstNode().contentHash));
    edited[0].text += ' Synthetic local edit.';
    firstNode().contentHash = addContentDelta(snapshot.state.contentStore, edited, firstNode().contentHash);
    await measure('bodyEdit', () => session.synchronize(snapshot));
    const checkBody = () => {
      const actual = resolveContentStrict(snapshot.state.contentStore, firstNode().contentHash);
      assert(actual.length === edited.length && actual.every((part, i) => part.type === edited[i].type && part.text === edited[i].text), 'Edited body changed.');
    };
    checkBody();
    const nodes = Object.values(treeChat().branchTree.nodes);
    nodes[1].contentHash = addContent(snapshot.state.contentStore, resolveContentStrict(snapshot.state.contentStore, nodes[0].contentHash));
    await measure('sharedBody', () => session.synchronize(snapshot));
    const shared = Object.values(treeChat().branchTree.nodes);
    assert(shared[0].contentHash === shared[1].contentHash, 'Shared body was duplicated.');
    await measure('restartPull', async () => {
      session.close(); session = new EncryptedSync(dataset, transport);
      await session.unlock(password); return session.pull();
    });
    assert(treeChat().title === 'Synthetic edited title', 'Restart title changed.'); checkBody();
    return { workerCreations, indexedDBVerified: true };
  }, { scale, bodyBytes, smoke });
  Object.assign(report, summary, { complete: true });
  await save(); console.log(JSON.stringify({ report: reportPath, complete: true }));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await save(); console.error(JSON.stringify({ report: reportPath, complete: false, error: report.error }));
  process.exitCode = 1;
} finally { await browser.close(); }
