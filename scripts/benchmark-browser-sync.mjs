import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Synthetic data only. Run each scale in a separate browser/process.
// node scripts/benchmark-browser-sync.mjs --scale=1 --report=path [--smoke] [--wire-compression=gzip|legacy] [--verify-pack]
const smoke = process.argv.includes('--smoke');
const verifyPack = process.argv.includes('--verify-pack');
const checkpointOnly = process.argv.includes('--checkpoint-only');
const scale = Number(process.argv.find(arg => arg.startsWith('--scale='))?.slice(8) ?? 1);
const wireCompression = process.argv.find(arg => arg.startsWith('--wire-compression='))?.slice(19);
if (wireCompression !== undefined && !['gzip', 'legacy'].includes(wireCompression)) throw new Error('Unsupported wire compression option.');
const bodyBytes = Number(process.env.SYNC_SCALE_BENCH_BODY_BYTES ?? (smoke ? 256 : 5300));
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9) ??
  `docs/development/reports/browser-sync-checkpoint-${wireCompression === 'legacy' ? 'legacy-' : ''}scale${scale}${checkpointOnly ? '-checkpoint-only' : ''}${smoke ? '-smoke' : ''}.json`;
const origin = process.env.WEAVELET_TEST_URL ?? 'http://127.0.0.1:5177';
const report = { createdAt: new Date().toISOString(), scale, bodyBytes, smoke, verifyPack, checkpointOnly, complete: false,
  wireCompression: wireCompression ?? 'gzip',
  smallUpdateCodec: 'Existing inline LZ for parented updates with a conservative JSON bound at most 64 KiB; actual inline payload at most 256 KiB.',
  checkpointPolicy: 'Transport supports production checkpoint discovery and automatic publication; original logical history is retained.',
  concurrentBenchmarkLoad: process.env.SYNC_BENCH_CONCURRENT_LOAD === '1',
  limitations: ['Synthetic text only; no personal exports read.',
    'Repeated fictional text is highly compressible; matching node/JSON sizes does not reproduce the export compression ratio.',
    'Real Chrome Worker and IndexedDB, zero-latency mock network; no Google Drive traffic.',
    'restartPull/checkpointReopen recreate the Engine and read real IndexedDB in the same page; the Worker/browser process and its caches stay alive.',
    'Warm reopen may read commits after its durable replay checkpoint; oldCommitEntries counts only the initial history commit(s), not those newer tails.',
    'A first cloud checkpoint use downloads authenticated history and checkpoint verification compares its entire replayed records/conflicts exactly; it is not a history-download bypass.',
    'One sample; CPU contention and garbage collection affect timings.',
    'Every received snapshot is compared against all input sync records outside its timed interval; this uses the same Worker and can warm its bounded caches.',
    'JS heap readings exclude reliable process/Worker peak memory measurement.',
    'Benchmark-only Engine/Worker method events are delivered to Node without arguments or per-event disk writes; this adds IPC overhead.',
    'Benchmark-only Worker/IndexedDB instrumentation and 20-second diagnostics heartbeats add overhead; a 120-second scenario watchdog saves the latest available diagnostics and closes the isolated browser.'], scenarios: {} };
if (wireCompression !== 'legacy') report.limitations.push('Gzip is the new default; clients predating native gzip cannot read its v4 commits/v3 packs. Explicit legacy compression remains available.');
if (wireCompression !== 'legacy') report.limitations.push('Native remote payloads are limited to 256 MiB actual UTF-8 each; this is not a total memory/retention limit. Splitting larger payloads before encoding is deferred.');
if (verifyPack) report.limitations.push('freshPackPull deletes only the isolated benchmark context sync-private IndexedDB; mock remote files and the Worker/browser process remain alive.');
await mkdir(dirname(reportPath), { recursive: true });
let saveQueue = Promise.resolve();
const save = () => { const json = JSON.stringify(report, null, 2) + '\n'; return saveQueue = saveQueue.then(() => writeFile(reportPath, json)); };
let scenarioTimer, heartbeatTimer, activeScenario;
let diagnosticPage;
const collectDiagnostics = async () => {
  if (!diagnosticPage) return;
  const diagnostics = await Promise.race([
    diagnosticPage.evaluate(() => window.syncBenchmarkDiagnostics?.()).catch(() => undefined),
    new Promise(resolve => { const timer = setTimeout(resolve, 2000); timer.unref(); }),
  ]);
  if (diagnostics) report.diagnostics = diagnostics;
};
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  report.browser = await browser.version();
  const cdp = await browser.newBrowserCDPSession();
  report.browserProcessIds = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(({ type, id }) => ({ type, id }));
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  cdp.on('Target.targetCrashed', ({ status, errorCode }) => {
    report.targetCrashes = [...(report.targetCrashes ?? []), { status, errorCode, at: new Date().toISOString(), scenario: activeScenario }].slice(-32);
    void save();
  });
  const page = await browser.newPage(); diagnosticPage = page;
  report.moduleRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && /\.(ts|tsx|js|mjs)$/.test(url.pathname) && !report.moduleRequests.includes(url.href)) report.moduleRequests.push(url.href);
  });
  const recordPageEvent = type => {
    report.pageEvents = [...(report.pageEvents ?? []), { type, at: new Date().toISOString(), scenario: activeScenario }].slice(-32);
    void save();
  };
  page.on('pageerror', () => recordPageEvent('pageerror'));
  page.on('crash', async () => {
    recordPageEvent('pagecrash');
    report.error = 'Benchmark page crashed.';
    clearTimeout(scenarioTimer); clearInterval(heartbeatTimer);
    // One event-loop turn lets the independent browser CDP crash event be recorded before close.
    await new Promise(resolve => setImmediate(resolve));
    await save(); await browser.close();
  });
  heartbeatTimer = setInterval(async () => {
    await collectDiagnostics();
    report.heartbeat = { at: new Date().toISOString(), scenario: activeScenario ?? 'betweenScenarios', lastWorkerOperation: report.diagnostics?.workerTrace?.at(-1) ?? null };
    await save(); console.log(JSON.stringify({ heartbeat: report.heartbeat }));
  }, 20000);
  await page.route('**/__sync-benchmark__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic sync benchmark</title>' }));
  await page.goto(`${origin}/__sync-benchmark__`);
  await page.exposeFunction('benchmarkProgress', async value => {
    if (value.workerCreated) {
      report.workers = [...(report.workers ?? []), value.workerCreated];
      return;
    }
    if (value.workerOperation) {
      report.diagnostics ??= {};
      report.diagnostics.workerTrace = [...(report.diagnostics.workerTrace ?? []), value.workerOperation].slice(-32);
      Object.assign(report.diagnostics, value.activeOperations);
      return;
    }
    if (value.engineOperation) {
      report.engineTrace = [...(report.engineTrace ?? []), value.engineOperation].slice(-32);
      return;
    }
    if (value.phase === 'start') {
      activeScenario = value.scenarioName;
      clearTimeout(scenarioTimer);
      scenarioTimer = setTimeout(async () => {
        report.error = 'Scenario exceeded the 120-second benchmark watchdog.';
        await collectDiagnostics();
        report.timeout = { scenario: activeScenario, limitMs: 120000, at: new Date().toISOString(), diagnostics: report.diagnostics ?? null };
        await save(); console.error(JSON.stringify({ timeout: report.timeout }));
        await browser.close();
      }, 120000);
    }
    if (value.scenario) { clearTimeout(scenarioTimer); activeScenario = undefined; report.scenarios[value.scenario] = value.measurement; }
    if (value.diagnostics) report.diagnostics = value.diagnostics;
    else if (value.summary) Object.assign(report, value.summary);
    await save();
    console.log(JSON.stringify(value));
  });
  const summary = await page.evaluate(async ({ scale, bodyBytes, smoke, wireCompression, verifyPack, checkpointOnly }) => {
    const { createSyntheticSnapshot, SYNTHETIC_PROFILE } = await import('/src/store/storage/google/synthetic.ts');
    const { EncryptedSync } = await import('/src/store/storage/sync/EncryptedSync.ts');
    const { resetSyncMetrics, getSyncMetrics } = await import('/src/store/storage/google/metrics.ts');
    const { addContent, addContentDelta, resolveContentStrict } = await import('/src/utils/contentStore.ts');
    const { readSyncEntries } = await import('/src/store/storage/google/cache.ts');
    const { sameSnapshotAsync } = await import('/src/store/storage/google/processing.ts');
    let workerCreations = 0, workerOperations = {};
    const checkpointVerificationCalls = () => (workerOperations.verifyCheckpoint ?? 0) + (workerOperations.decodeVerifyCheckpoint ?? 0);
    const workerTrace = [], pendingWorkers = new Map(), engineTrace = [];
    for (const operation of ['hydrateHistory', 'refresh', 'remote', 'checkpoint', 'finishCheckpoint', 'save']) {
      const native = EncryptedSync.prototype[operation];
      EncryptedSync.prototype[operation] = async function(...args) {
        const trace = event => { const item = { event, operation, atMs: performance.now() }; engineTrace.push(item); if (engineTrace.length > 32) engineTrace.shift(); void window.benchmarkProgress({ engineOperation: item }); };
        trace('start');
        try { const result = await native.apply(this, args); trace('end'); return result; }
        catch (error) { trace('error'); throw error; }
      };
    }
    const operationNames = new Set(['encode', 'decode', 'encodeCache', 'decodeCache', 'toRecords', 'projectRecords', 'fromRecords', 'fromRecordsWithContent', 'hashRecords', 'hashCommits', 'sameSnapshot', 'replayHistory', 'collectHistory', 'decodeParts', 'encodeWire', 'decodeWireParts', 'prepareHydratedData', 'prepareSave', 'encodeNative', 'hashNativeCommits', 'decodeNativeParts', 'createCheckpoint', 'verifyCheckpoint', 'createEncodedCheckpoint', 'decodeVerifyCheckpoint']);
    let idbActiveRequests = 0, idbActiveTransactions = 0;
    const trace = (event, id, operation, workerId) => {
      const item = { event, workerId, id: Number.isSafeInteger(id) ? id : null, operation, atMs: performance.now() };
      workerTrace.push(item); if (workerTrace.length > 32) workerTrace.shift();
      void window.benchmarkProgress({ workerOperation: item, activeOperations: { idbActiveRequests, idbActiveTransactions, pendingWorkerOperations: pendingWorkers.size } });
    };
    window.syncBenchmarkDiagnostics = () => ({ workerTrace: [...workerTrace], engineTrace: [...engineTrace], idbActiveRequests, idbActiveTransactions, pendingWorkerOperations: pendingWorkers.size });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); this.benchmarkId = ++workerCreations;
        void window.benchmarkProgress({ workerCreated: { workerId: this.benchmarkId, url: new URL(String(args[0]), location.href).href, atMs: performance.now() } });
        this.addEventListener('message', ({ data }) => {
          if (data?.progress !== undefined) return;
          const key = `${this.benchmarkId}:${data?.id}`;
          const operation = pendingWorkers.get(key) ?? 'unknown';
          pendingWorkers.delete(key); trace(data?.error === undefined ? 'response' : 'error', data?.id, operation, this.benchmarkId);
        });
        for (const event of ['error', 'messageerror']) this.addEventListener(event, () => trace(event, null, 'unknown', this.benchmarkId));
      }
      postMessage(value, ...options) {
        const operation = operationNames.has(value?.operation) ? value.operation : 'unknown';
        workerOperations[operation] = (workerOperations[operation] ?? 0) + 1;
        pendingWorkers.set(`${this.benchmarkId}:${value?.id}`, operation); trace('start', value?.id, operation, this.benchmarkId);
        return super.postMessage(value, ...options);
      }
    };
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const progress = value => window.benchmarkProgress(value);
    let next = 0, uploadedBytes = 0, downloadedBytes = 0, calls = {}, readsByKind = {}, readsByPurpose = {};
    let idbReads = { commitEntries: 0, oldCommitEntries: 0, replayEntries: 0, otherEntries: 0 }, session, dataset;
    const initialHistory = new Set();
    const trackRequest = request => {
      idbActiveRequests++;
      const done = () => { idbActiveRequests--; };
      request.addEventListener('success', done, { once: true }); request.addEventListener('error', done, { once: true });
      return request;
    };
    for (const method of ['put', 'delete', 'clear', 'getAll', 'getAllKeys', 'count']) {
      const native = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function(...args) { return trackRequest(native.apply(this, args)); };
    }
    const nativeTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      const transaction = nativeTransaction.apply(this, args); idbActiveTransactions++;
      const done = () => { idbActiveTransactions--; };
      transaction.addEventListener('complete', done, { once: true }); transaction.addEventListener('abort', done, { once: true });
      return transaction;
    };
    const nativeGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === 'entries' && Array.isArray(key) && key[0] === dataset) {
        const id = key[1];
        const kind = typeof id === 'string' && id.startsWith('commit:') ? 'commitEntries' : id === 'replay' ? 'replayEntries' : 'otherEntries';
        idbReads[kind] = (idbReads[kind] ?? 0) + 1;
        if (kind === 'commitEntries' && initialHistory.has(id.slice(7))) idbReads.oldCommitEntries = (idbReads.oldCommitEntries ?? 0) + 1;
      }
      return trackRequest(nativeGet.call(this, key));
    };
    const headers = new Map(), files = new Map(), events = [];
    const count = method => { calls[method] = (calls[method] ?? 0) + 1; };
    const list = (dataset, kind) => [...files].filter(([, f]) => f.dataset === dataset && f.kind === kind).map(([id]) => id);
    const transport = {
      async ids(countValue) { count('ids'); return Array.from({ length: countValue }, () => `synthetic-${++next}`); },
      async folder(id, header) { count('folder'); headers.set(id, header); return { id }; },
      async keyHeader(dataset) { count('keyHeader'); const header = headers.get(dataset); assert(header, 'Missing synthetic key header.'); return header; },
      async read(id, purpose = 'normal') {
        count('read'); const file = files.get(id); assert(file, 'Missing synthetic file.');
        readsByKind[file.kind] = (readsByKind[file.kind] ?? 0) + 1;
        readsByPurpose[purpose] = (readsByPurpose[purpose] ?? 0) + 1;
        downloadedBytes += file.bytes.length; return file.bytes.slice();
      },
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
      async checkpoints(dataset) { count('checkpoints'); return list(dataset, 'checkpoint'); },
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
    const measure = async (name, work) => {
      await progress({ phase: 'start', scenarioName: name, diagnostics: window.syncBenchmarkDiagnostics() });
      uploadedBytes = downloadedBytes = 0; calls = {}; readsByKind = {}; readsByPurpose = {}; idbReads = { commitEntries: 0, oldCommitEntries: 0, replayEntries: 0, otherEntries: 0 }; workerOperations = {}; resetSyncMetrics();
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
        remoteReadsByKind: { ...readsByKind }, remoteReadsByPurpose: { ...readsByPurpose },
        indexedDBReads: { ...idbReads }, workerOperations: { ...workerOperations },
        checkpointVerificationCalls: checkpointVerificationCalls(), historyReplayCalls: workerOperations.replayHistory ?? 0,
        remoteFileCounts: Object.fromEntries([...new Set([...files.values()].map(file => file.kind))].map(kind => [kind, list(dataset, kind).length])),
        remoteStorageBytes: [...files.values()].reduce((n, file) => n + file.bytes.length, 0),
        workerCreations, metrics: getSyncMetrics(), memoryBefore, memoryAfter: performance.memory?.usedJSHeapSize,
        maxMainThreadLagMs, heartbeatTicks };
      validate(received);
      assert(await sameSnapshotAsync(snapshot, received), 'Received logical sync records differ from the input.');
      measurement.exactSnapshotVerified = true; snapshot = received;
      // Probe real IDB outside the timed interval; avoids treating API presence as proof of storage use.
      assert((await readSyncEntries(dataset, ['replay']))[0] instanceof Uint8Array, 'Real replay cache was not persisted.');
      await progress({ scenario: name, measurement, diagnostics: window.syncBenchmarkDiagnostics() });
    };
    await measure('initial', async () => {
      const created = await EncryptedSync.create(transport, password, wireCompression ? { wireCompression } : {});
      session = created.session; dataset = created.file.id;
      return session.synchronize(snapshot, true);
    });
    assert(workerCreations > 0, 'A real Worker was not created.');
    for (const id of list(dataset, 'commit')) initialHistory.add(id);
    if (wireCompression !== 'legacy') assert(list(dataset, 'checkpoint').length > 0, 'Automatic checkpoint was not published.');
    if (checkpointOnly) {
      snapshot.state.chats.find(chat => chat.branchTree).title = 'Synthetic checkpoint tail';
      await measure('checkpointTitleTail', () => session.synchronize(snapshot));
      await measure('checkpointPublish', async () => { await session.checkpointHistory(); return session.pull(); });
      await measure('checkpointReopen', async () => {
        session.close(); session = new EncryptedSync(dataset, transport);
        await session.unlock(password); return session.pull();
      });
      assert(idbReads.commitEntries === 0, 'Warm checkpoint reopen reread logical commit bodies.');
      await measure('checkpointFreshPull', async () => {
        session.close();
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('weavelet-google-sync');
          request.onsuccess = resolve; request.onerror = () => reject(new Error('Synthetic cache deletion failed.'));
          request.onblocked = () => reject(new Error('Synthetic cache deletion blocked.'));
        });
        session = new EncryptedSync(dataset, transport); await session.unlock(password); return session.pull();
      });
      assert(checkpointVerificationCalls() > 0, 'Fresh checkpoint skipped authenticated history verification.');
      return { workerCreations, indexedDBVerified: true };
    }
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
    if (wireCompression !== 'legacy') {
      const previousCheckpoints = list(dataset, 'checkpoint').length;
      await measure('checkpointPublish', async () => { await session.checkpointHistory(); return session.pull(); });
      assert(list(dataset, 'checkpoint').length > previousCheckpoints, 'Explicit checkpoint did not cover the new tail.');
      assert(checkpointVerificationCalls() > 0, 'Published checkpoint was not checked against actual history.');
      await measure('checkpointReopen', async () => {
        session.close(); session = new EncryptedSync(dataset, transport);
        await session.unlock(password); return session.pull();
      });
      assert((idbReads.oldCommitEntries ?? 0) === 0, 'Warm checkpoint reopen reread the old initial commit body.');
      assert((workerOperations.replayHistory ?? 0) === 0 && checkpointVerificationCalls() === 0,
        'Warm checkpoint reopen unnecessarily replayed verified old history.');
      assert(treeChat().title === 'Synthetic edited title', 'Checkpoint reopen title changed.'); checkBody();
    }
    if (verifyPack) {
      await measure('packAggregation', async () => { await session.compactHistory(); return session.pull(); });
      assert(list(dataset, 'pack').length > 0, 'Aggregation did not publish a pack.');
      assert(treeChat().title === 'Synthetic edited title', 'Aggregated title changed.'); checkBody();
      await measure('freshPackPull', async () => {
        session.close();
        // This fresh browser context has never loaded the app or personal data.
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('weavelet-google-sync');
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error('Synthetic sync cache deletion failed.'));
          request.onblocked = () => reject(new Error('Synthetic sync cache deletion was blocked.'));
        });
        session = new EncryptedSync(dataset, transport);
        await session.unlock(password); return session.pull();
      });
      assert(treeChat().title === 'Synthetic edited title', 'Fresh pack title changed.'); checkBody();
      const freshShared = Object.values(treeChat().branchTree.nodes);
      assert(freshShared[0].contentHash === freshShared[1].contentHash, 'Fresh pack duplicated shared content.');
      assert(calls.history > 0 && downloadedBytes > 1000, 'Fresh reader did not retrieve remote pack data.');
      if (wireCompression !== 'legacy') {
        assert((readsByKind.checkpoint ?? 0) > 0 && (readsByKind['checkpoint-part'] ?? 0) > 0,
          'Fresh reader did not fetch the cloud checkpoints.');
        assert(checkpointVerificationCalls() > 0, 'Fresh cloud checkpoint bypassed exact history verification.');
      }
    }
    return { workerCreations, indexedDBVerified: true, checkpointVerification: wireCompression === 'legacy' ? 'disabled in explicit legacy mode' : 'Exact authenticated source-history replay on cloud checkpoint first use; warm reopen reuses the locally verified checkpoint.' };
  }, { scale, bodyBytes, smoke, wireCompression, verifyPack, checkpointOnly });
  Object.assign(report, summary, { complete: true });
  await save(); console.log(JSON.stringify({ report: reportPath, complete: true }));
} catch (error) {
  report.error ??= error instanceof Error ? error.message : String(error);
  await save(); console.error(JSON.stringify({ report: reportPath, complete: false, error: report.error }));
  process.exitCode = 1;
} finally { clearTimeout(scenarioTimer); clearInterval(heartbeatTimer); await browser.close(); }
