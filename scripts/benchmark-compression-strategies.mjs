import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Benchmark only; no production format or personal data is used.
// --profile=repeated|structured|incompressible|all --body-bytes=5300 --repetitions=1 --scale=1 [--smoke] [--transport]
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const smoke = process.argv.includes('--smoke');
const transport = process.argv.includes('--transport');
const config = { smoke, transport, profile: arg('profile', 'all'), bodyBytes: Number(arg('body-bytes', smoke ? '256' : '5300')),
  editBodyBytes: Number(arg('edit-body-bytes', '5300')),
  strategies: arg('strategies', 'all').split(','),
  injectFailure: arg('inject-failure', ''),
  repetitions: Number(arg('repetitions', '1')), scale: Number(arg('scale', '1')), seed: Number(arg('seed', '12345')) };
const origin = process.env.WEAVELET_TEST_URL ?? 'http://127.0.0.1:5177';
const path = arg('report', `docs/development/reports/compression-strategies${smoke ? '-smoke' : ''}.json`);
const report = { createdAt: new Date().toISOString(), config, complete: false, allCandidatesSucceeded: true,
  candidateFailures: 0, componentFailures: [], cases: [],
  timingInterpretation: 'cpuAndLocalMs is modeled elapsed processing/local time, not CPU time or measured production Engine total time. Worker IPC and benchmark protocol hashing are included as itemized.',
  limitations: [
    'Structured synthetic means fictional Japanese/English/code and seeded edits; representativeness of personal body distributions is unverified.',
    'No personal export bodies, titles or IDs were read. Synthetic input generation and record projection are excluded from candidate CPU models.',
    'Each component/codec is measured once per repetition and reused across candidate strategies: offline comparison, not runtime adaptive selection.',
    'After codec failure the Worker is recycled before the next operation, isolating failed dictionary allocations. Worker restart/startup is excluded from candidate timings.',
    'Native canonical commit hashing is measured once and added to framed candidate models. The legacy inline control instead includes logical-LZ encode plus inline-LZ encode and one inline decode.',
    'Production commit/pack hash costs and framing differ. Candidate bytes/timings are not exact production Engine totals; inline controls preserve the meaningful one-file versus two-file distinction.',
    'Codec internals and real Worker round-trip times are both measured. Partition/serialization/frame assembly/restore run on the main thread.',
    '20-byte experimental binary framing is constructed for whole/split candidates. Existing-inline-lz is the actual version-2 LZ manifest control, without this header or a separate manifest.',
    'Without --transport, encryption/IDB are not executed; 28-byte AES-GCM overhead per 1 MiB data part is modeled and manifests are excluded.',
    'With --transport, CPU/local models add encryptMs+decryptMs+writeMs+readMs. transportObservedMs separately retains benchmark key setup/validation/cleanup wall time.',
    'Network models assume symmetric 10/50/100 Mbps and RTT 0/100 ms. RTT uses concurrency 2 and ceil(dataParts/2)+1 waves each direction; shared folder/key work and HTTP overhead are excluded.',
    'No real network transfer, reliable peak-memory or hardware-acceleration measurement. Pareto comparisons concern measured storage/CPU only.',
  ] };
await mkdir(dirname(path), { recursive: true });
const save = () => writeFile(path, JSON.stringify(report, null, 2) + '\n');
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  report.browser = await browser.version();
  const page = await browser.newPage();
  await page.route('**/__compression-strategies__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic compression strategies</title>' }));
  await page.goto(`${origin}/__compression-strategies__`);
  await page.exposeFunction('strategyProgress', async value => {
    if (value.failure) { report.componentFailures.push(value); report.allCandidatesSucceeded = false; }
    if (value.caseResult) {
      report.cases.push(value.caseResult);
      const failures = value.caseResult.candidates.filter(candidate => candidate.status === 'error').length;
      report.candidateFailures += failures;
      if (failures) report.allCandidatesSucceeded = false;
    }
    if (value.summary) Object.assign(report, value.summary);
    await save(); console.log(JSON.stringify(value.caseResult ? { profile: value.caseResult.profile,
      workload: value.caseResult.workload, repetition: value.caseResult.repetition,
      candidateCount: value.caseResult.candidates.length,
      candidateFailures: value.caseResult.candidates.filter(candidate => candidate.status === 'error').length, complete: true } : value));
  });
  await page.evaluate(async config => {
    const { createSyntheticSnapshot, SYNTHETIC_PROFILE } = await import('/src/store/storage/google/synthetic.ts');
    const { toRecords } = await import('/src/store/storage/google/records.ts');
    const { digest } = await import('/src/store/storage/google/crypto.ts');
    const { addContent } = await import('/src/utils/contentStore.ts');
    const { partitionCompression, restoreCompression, compressionPartitionStats } = await import('/src/store/storage/google/compressionPartition.bench.ts');
    const measureTransport = config.transport ? (await import('/src/store/storage/google/compressionTransport.bench.ts')).measureCompressionTransport : undefined;
    const progress = value => window.strategyProgress(value);
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    assert(['all', 'repeated', 'structured', 'incompressible'].includes(config.profile), 'Invalid synthetic profile.');
    assert(Number.isSafeInteger(config.repetitions) && config.repetitions > 0, 'Invalid repetition count.');
    assert(Number.isSafeInteger(config.editBodyBytes) && config.editBodyBytes > 0, 'Invalid edit body size.');
    const encoder = new TextEncoder();
    const utf8 = value => encoder.encode(value).length;
    const workerMain = async origin => {
      const lz = (await import(`${origin}/node_modules/.vite/deps/lz-string.js`)).default;
      const { hashNativeCommits } = await import(`${origin}/src/store/storage/google/nativeWireCodec.ts`);
      self.onmessage = async ({ data }) => {
        try {
          const started = performance.now();
          let value;
          if (data.operation === 'hash') {
            value = Object.keys(await hashNativeCommits(data.value)).length;
          } else if (data.operation === 'encode') {
            value = data.codec === 'none' ? new TextEncoder().encode(data.value) : data.codec === 'lz'
              ? lz.compressToUint8Array(data.value) : new Uint8Array(await new Response(
                new Blob([data.value]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
          } else {
            value = data.codec === 'none' ? new TextDecoder('utf-8', { fatal: true }).decode(data.value) : data.codec === 'lz'
              ? lz.decompressFromUint8Array(data.value) : new TextDecoder('utf-8', { fatal: true }).decode(await new Response(
                new Blob([data.value]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
            if (typeof value !== 'string') throw new Error('Codec restoration failed.');
          }
          const ms = performance.now() - started;
          self.postMessage({ id: data.id, ms, value }, value instanceof Uint8Array ? [value.buffer] : []);
        } catch (error) {
          const message = String(error?.message ?? '').toLowerCase();
          self.postMessage({ id: data.id, error: { name: String(error?.name ?? 'Error'),
            category: message.includes('string length') ? 'string-length-limit' : message.includes('call stack') ? 'stack-limit' :
              message.includes('memory') ? 'out-of-memory' : message.includes('array length') ? 'array-length-limit' :
              message.includes('maximum map size') || message.includes('too many properties') ? 'dictionary-size-limit' : 'codec-error' } });
        }
      };
      self.postMessage({ ready: true });
    };
    const workerUrl = URL.createObjectURL(new Blob([`(${workerMain.toString()})(${JSON.stringify(location.origin)})`], { type: 'text/javascript' }));
    const startedWorker = performance.now();
    let worker, workerFailed = false, workerStarts = 0, nextId = 0;
    const requests = new Map();
    const startWorker = async () => {
    workerFailed = false; workerStarts++;
    const instance = worker = new Worker(workerUrl, { type: 'module' });
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    instance.onmessage = ({ data }) => {
      if (data.ready) { readyResolve(); return; }
      const pending = requests.get(data.id); requests.delete(data.id);
      if (data.error) {
        const error = new Error(`Synthetic codec failure (${data.error.category}).`);
        error.name = data.error.name; error.category = data.error.category; pending.reject(error);
      } else pending.resolve(data);
    };
    instance.onerror = () => {
      if (worker !== instance) return;
      workerFailed = true; instance.terminate();
      const error = Object.assign(new Error('Synthetic codec Worker failed.'), { name: 'WorkerError', category: 'worker-unavailable' });
      readyReject(error); for (const pending of requests.values()) pending.reject(error); requests.clear();
    };
    await ready;
    };
    await startWorker();
    await progress({ summary: { userAgent: navigator.userAgent, workerStartupMs: performance.now() - startedWorker, realWorker: true } });
    const operation = async (operation, codec, value) => {
      if (workerFailed) await startWorker();
      const started = performance.now(), id = nextId++;
      const result = await new Promise((resolve, reject) => {
        requests.set(id, { resolve, reject }); worker.postMessage({ id, operation, codec, value });
      });
      return { ...result, roundTripMs: performance.now() - started };
    };
    const profile = config.smoke ? { ...SYNTHETIC_PROFILE, treeChats: 2, treeNodes: 24, legacyChats: 3,
      legacyNodes: 30, maxTreeNodes: 16, maxDepth: 6, maxFanout: 5 } : SYNTHETIC_PROFILE;
    // Preserve body sharing, but create only fictional content with fixed seed.
    const structuredSnapshot = snapshot => {
      let seed = config.seed >>> 0, ordinal = 0, previous = '';
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
      const replacements = new Map();
      const transform = original => {
        if (replacements.has(original)) return replacements.get(original);
        let text;
        if (++ordinal % 4 && previous) {
          const marker = ` edit:${ordinal.toString(36).padStart(12, '0')}`;
          text = previous.slice(0, -marker.length) + marker;
        } else {
          const lines = [];
          let chars = 0;
          while (chars < config.bodyBytes) {
            const id = random(), value = random();
            const line = `Sample ${ordinal}/${id}: 日本語の架空データを確認します。 English "quoted" sample 🙂 result=${value}.\n\tconst item_${id} = { label: "sample-${id}", value: ${value}, enabled: ${value % 2 === 0} };\n`;
            lines.push(line); chars += line.length;
          }
          const bytes = encoder.encode(lines.join(''));
          let end = config.bodyBytes;
          while (true) {
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); break; }
            catch { end--; }
          }
          text += ' '.repeat(config.bodyBytes - utf8(text));
          previous = text;
        }
        replacements.set(original, text); return text;
      };
      const old = snapshot.state.contentStore, store = {}, ids = new Map();
      for (const [id, entry] of Object.entries(old)) ids.set(id, addContent(store, entry.content.map(part => ({ ...part, text: transform(part.text) }))));
      for (const chat of snapshot.state.chats) {
        for (const node of Object.values(chat.branchTree?.nodes ?? {})) node.contentHash = ids.get(node.contentHash);
        for (const message of chat.messages ?? []) for (const part of message.content) part.text = transform(part.text);
      }
      snapshot.state.contentStore = store; return snapshot;
    };
    const allCandidates = [
      { name: 'whole-none', whole: 'none' }, { name: 'whole-lz', whole: 'lz' }, { name: 'whole-gzip', whole: 'gzip' },
      { name: 'split-body-gzip-meta-gzip', body: 'gzip', meta: 'gzip' },
      { name: 'split-body-gzip-meta-lz', body: 'gzip', meta: 'lz' },
      { name: 'split-body-lz-meta-gzip', body: 'lz', meta: 'gzip' },
      { name: 'split-body-lz-meta-lz', body: 'lz', meta: 'lz' },
      { name: 'split-body-gzip-meta-none', body: 'gzip', meta: 'none' },
    ];
    assert(config.strategies.every(name => name === 'all' || name === 'existing-inline-lz' || allCandidates.some(candidate => candidate.name === name)), 'Invalid strategy filter.');
    const candidates = config.strategies.includes('all') ? allCandidates : allCandidates.filter(candidate => config.strategies.includes(candidate.name));
    const includeInline = config.strategies.includes('all') || config.strategies.includes('existing-inline-lz');
    try {
      for (const name of config.profile === 'all' ? ['repeated', 'structured', 'incompressible'] : [config.profile]) {
        for (let repetition = 0; repetition < config.repetitions; repetition++) {
          await progress({ profile: name, repetition, phase: 'generate' });
          let started = performance.now();
          let snapshot = createSyntheticSnapshot({ profile, bodyBytes: config.bodyBytes, scale: config.scale, seed: config.seed, incompressible: name === 'incompressible' });
          if (name === 'structured') snapshot = structuredSnapshot(snapshot);
          snapshot.state.defaultSystemMessage = 'Fictional system prompt for metadata compression testing. '.repeat(80);
          const generationMs = performance.now() - started;
          const snapshotBytes = utf8(JSON.stringify(snapshot));
          started = performance.now();
          const records = await toRecords(snapshot);
          const initial = { version: 1, parents: [], changes: Object.entries(records).map(([key, after]) => ({ key, before: null, after })) };
          const projectionMs = performance.now() - started;
          const titleKey = Object.keys(records).find(key => { const path = JSON.parse(key); return path[0] === 'chats' && path.length === 3 && path[2] === 'title'; });
          const contentKey = Object.keys(records).find(key => JSON.parse(key)[0] === 'content');
          const contentId = JSON.parse(contentKey)[1];
          const nodeKey = Object.keys(records).find(key => key.endsWith(',"contentHash"]') && records[key] === JSON.stringify(contentId));
          const legacyKey = Object.keys(records).find(key => { const path = JSON.parse(key); return path[0] === 'chats' && path.length === 3 && path[2] === 'messages'; });
          const content = JSON.parse(records[contentKey]); content[0].text += ' Synthetic local edit.';
          const expanded = encoder.encode(content[0].text.repeat(Math.ceil(config.editBodyBytes / utf8(content[0].text))));
          let cut = config.editBodyBytes;
          while (true) {
            try { content[0].text = new TextDecoder('utf-8', { fatal: true }).decode(expanded.subarray(0, cut)) + ' Synthetic local edit.'; break; }
            catch { cut--; }
          }
          const bodyAfter = JSON.stringify(content), newContentId = await digest(bodyAfter);
          const legacy = JSON.parse(records[legacyKey]); legacy[0].content[0].text += ' Synthetic local edit.';
          const title = { version: 1, parents: ['initial'], changes: [{ key: titleKey, before: await digest(records[titleKey]), after: JSON.stringify('Synthetic edited title') }] };
          const body = { version: 1, parents: ['initial'], changes: [
            { key: JSON.stringify(['content', newContentId]), before: null, after: bodyAfter },
            { key: nodeKey, before: await digest(records[nodeKey]), after: JSON.stringify(newContentId) }] };
          const legacyEdit = { version: 1, parents: ['initial'], changes: [{ key: legacyKey, before: await digest(records[legacyKey]), after: JSON.stringify(legacy) }] };
          const workloads = [{ name: 'initial', logical: initial }, { name: 'title-edit', logical: title },
            { name: 'tree-body-edit', logical: body }, { name: 'legacy-array-edit', logical: legacyEdit }];
          if (config.smoke || config.bodyBytes <= 1000) workloads.push({ name: 'small-pack', logical: { version: 1,
            commits: { initial, title, body: { ...body, parents: ['title'] }, legacy: { ...legacyEdit, parents: ['body'] } } } });
          for (const workload of workloads) {
          const logical = workload.logical;
          const commitInputs = Object.hasOwn(logical, 'commits') ? logical.commits : { payload: logical };
          const nativeHash = await operation('hash', undefined, commitInputs);
          assert(nativeHash.value === Object.keys(commitInputs).length, 'Native commit hashing did not complete.');
          started = performance.now(); const wholeJson = JSON.stringify(logical); const wholeSerializeMs = performance.now() - started;
          started = performance.now(); const partition = partitionCompression(logical); const partitionMs = performance.now() - started;
          started = performance.now(); const metaJson = JSON.stringify(partition.metadata); const metaSerializeMs = performance.now() - started;
          started = performance.now(); const bodyJson = JSON.stringify(partition.bodies); const bodySerializeMs = performance.now() - started;
          const metadataKinds = {};
          for (const change of (Object.hasOwn(partition.metadata, 'commits') ? Object.values(partition.metadata.commits) : [partition.metadata]).flatMap(commit => commit.changes)) {
            const path = JSON.parse(change.key);
            const kind = path[0] === 'chats' ? `chats/${path[2] ?? 'root'}/${path[2] === 'branchTree' ? path.at(-1) : ''}` :
              ['content', 'assets'].includes(path[0]) ? path[0] : `${path[0]}/${path[1] ?? ''}`;
            const item = metadataKinds[kind] ??= { kind, bytes: 0, records: 0 };
            item.bytes += utf8(JSON.stringify(change)); item.records++;
          }
          const row = { profile: name, workload: workload.name, repetition, snapshotBytes, generationMs, projectionMs, wholeSerializeMs,
            nativeHashMs: nativeHash.ms, nativeHashWorkerRoundTripMs: nativeHash.roundTripMs,
            metadataRecordKinds: Object.values(metadataKinds).sort((a, b) => b.bytes - a.bytes).slice(0, 12),
            partitionMs, metaSerializeMs, bodySerializeMs, stats: compressionPartitionStats(partition), components: {}, candidates: [] };
          const encoded = {};
          const required = { whole: new Set(), metadata: new Set(), bodies: new Set() };
          for (const candidate of candidates) {
            if (candidate.whole) required.whole.add(candidate.whole);
            else { required.metadata.add(candidate.meta); required.bodies.add(candidate.body); }
          }
          if (includeInline && logical.parents?.length) required.whole.add('lz');
          for (const [component, json] of Object.entries({ whole: wholeJson, metadata: metaJson, bodies: bodyJson })) {
            row.components[component] = {}; encoded[component] = {};
            const rawBytes = utf8(json);
            for (const codec of required[component]) {
              await progress({ profile: name, workload: workload.name, repetition, component, codec, phase: 'codec' });
              let stage = 'encode';
              let compressed;
              try {
              if (config.injectFailure === `${component}:${codec}:${stage}`) throw Object.assign(new RangeError('Injected codec failure.'), { category: 'injected-test-failure' });
              compressed = await operation('encode', codec, json);
              stage = 'decode';
              if (config.injectFailure === `${component}:${codec}:${stage}`) throw Object.assign(new RangeError('Injected codec failure.'), { category: 'injected-test-failure' });
              const restored = await operation('decode', codec, compressed.value);
              assert(restored.value === json, 'Component JSON bytes changed after codec round trip.');
              encoded[component][codec] = compressed.value;
              row.components[component][codec] = { status: 'ok', rawBytes, compressedBytes: compressed.value.length,
                encodeMs: compressed.ms, decodeMs: restored.ms, encodeWorkerRoundTripMs: compressed.roundTripMs,
                decodeWorkerRoundTripMs: restored.roundTripMs, exactJsonRoundtrip: true };
              } catch (error) {
                const failure = { status: 'error', rawBytes, stage, name: String(error?.name ?? 'Error'), category: error.category ?? 'codec-error',
                  compressedBytes: compressed?.value.length ?? null, observedEncodeMs: compressed?.ms ?? null,
                  encodeMs: null, decodeMs: null, exactJsonRoundtrip: false };
                row.components[component][codec] = failure;
                await progress({ profile: name, workload: workload.name, repetition, component, codec, failure });
                // A failed LZ dictionary must not make the following native codec pay its GC cost.
                worker.terminate(); workerFailed = true;
              }
            }
          }
          for (const candidate of candidates) {
            const metaCodec = candidate.whole ?? candidate.meta, bodyCodec = candidate.whole ? undefined : candidate.body;
            const componentRows = [row.components[candidate.whole ? 'whole' : 'metadata'][metaCodec], ...(bodyCodec ? [row.components.bodies[bodyCodec]] : [])];
            const failure = componentRows.find(component => component.status === 'error');
            if (failure) {
              row.candidates.push({ ...candidate, status: 'error', failure, cpuAndLocalMs: null, encryptedTransferBytes: null,
                encodeMs: null, decodeMs: null, networkModels: [], exactLogicalRoundtrip: false }); continue;
            }
            const metadata = encoded[candidate.whole ? 'whole' : 'metadata'][metaCodec];
            const bodies = bodyCodec ? encoded.bodies[bodyCodec] : new Uint8Array();
            started = performance.now();
            const frame = new Uint8Array(20 + metadata.length + bodies.length), view = new DataView(frame.buffer);
            frame.set([87, 66, 67, 49, 1, bodyCodec ? 2 : 1, ['none', 'lz', 'gzip'].indexOf(metaCodec), bodyCodec ? ['none', 'lz', 'gzip'].indexOf(bodyCodec) : 255]);
            view.setUint32(8, metadata.length, true); view.setUint32(12, bodies.length, true); view.setUint32(16, row.stats.logicalJsonBytes, true);
            frame.set(metadata, 20); frame.set(bodies, 20 + metadata.length);
            const frameAssemblyMs = performance.now() - started;
            assert(view.getUint32(8, true) === metadata.length && view.getUint32(12, true) === bodies.length &&
              metadata.every((value, i) => frame[i + 20] === value) && bodies.every((value, i) => frame[i + 20 + metadata.length] === value), 'Binary frame changed component payload bytes.');
            started = performance.now();
            const restored = candidate.whole ? JSON.parse(wholeJson) : restoreCompression({ format: partition.format, version: 1,
              metadata: JSON.parse(metaJson), bodies: JSON.parse(bodyJson) });
            const restoreMs = performance.now() - started;
            assert(JSON.stringify(restored) === wholeJson, 'Logical payload changed after partition restoration.');
            const parts = Math.ceil(frame.length / 1048576), modeledDataCiphertextBytes = frame.length + 28 * parts;
            started = performance.now();
            const actualTransport = measureTransport ? await measureTransport(frame) : undefined;
            const transportObservedMs = measureTransport ? performance.now() - started : 0;
            const transportModelMs = actualTransport ? actualTransport.encryptMs + actualTransport.decryptMs + actualTransport.writeMs + actualTransport.readMs : 0;
            if (actualTransport) assert(actualTransport.payloadCiphertextBytes === modeledDataCiphertextBytes &&
              actualTransport.fileCount === parts + 1 && actualTransport.ciphertextBytes ===
              actualTransport.payloadCiphertextBytes + actualTransport.manifestCiphertextBytes, 'Encrypted frame accounting mismatch.');
            const encryptedBytes = actualTransport?.ciphertextBytes ?? modeledDataCiphertextBytes;
            const preparationMs = candidate.whole ? wholeSerializeMs : partitionMs + metaSerializeMs + bodySerializeMs;
            const encodeMs = componentRows.reduce((n, entry) => n + entry.encodeMs, 0), decodeMs = componentRows.reduce((n, entry) => n + entry.decodeMs, 0);
            const workerCodecMs = componentRows.reduce((n, entry) => n + entry.encodeWorkerRoundTripMs + entry.decodeWorkerRoundTripMs, 0);
            const cpuAndLocalMs = preparationMs + workerCodecMs + frameAssemblyMs + restoreMs + transportModelMs + nativeHash.roundTripMs;
            row.candidates.push({ ...candidate, status: 'ok', compressedPayloadBytes: metadata.length + bodies.length, binaryHeaderBytes: 20,
              framedBytes: frame.length, dataParts: parts, modeledDataAesOverheadBytes: 28 * parts, modeledDataCiphertextBytes,
              actualTransport, transportObservedMs, transportModelMs, encryptedTransferBytes: encryptedBytes,
              preparationMs, encodeMs, decodeMs, workerCodecMs, frameAssemblyMs, restoreMs, cpuAndLocalMs,
              separateManifest: true, nativeHashIncluded: true,
              exactLogicalRoundtrip: true });
          }
          if (includeInline && logical.parents?.length && row.components.whole.lz.status === 'error') {
            row.candidates.push({ name: 'existing-inline-lz', status: 'error', failure: row.components.whole.lz,
              cpuAndLocalMs: null, encryptedTransferBytes: null, encodeMs: null, decodeMs: null, networkModels: [], exactLogicalRoundtrip: false });
          }
          if (includeInline && Array.isArray(logical.parents) && logical.parents.length > 0 && encoded.whole.lz?.length <= 256 * 1024) {
            started = performance.now(); const inlineJson = JSON.stringify({ ...logical, version: 2 });
            const inlineSerializeMs = performance.now() - started;
            const compressed = await operation('encode', 'lz', inlineJson);
            const decoded = await operation('decode', 'lz', compressed.value);
            assert(decoded.value === inlineJson, 'Inline LZ JSON restoration failed.');
            started = performance.now(); const restored = JSON.parse(decoded.value); restored.version = 1;
            const restoreMs = performance.now() - started;
            assert(JSON.stringify(restored) === wholeJson, 'Inline LZ logical restoration failed.');
            started = performance.now(); const actualTransport = measureTransport ? await measureTransport(compressed.value, { inline: true }) : undefined;
            const transportObservedMs = measureTransport ? performance.now() - started : 0;
            const transportModelMs = actualTransport ? actualTransport.encryptMs + actualTransport.decryptMs + actualTransport.writeMs + actualTransport.readMs : 0;
            if (actualTransport) assert(actualTransport.fileCount === 1 && actualTransport.manifestCiphertextBytes === 0 &&
              actualTransport.ciphertextBytes === compressed.value.length + 28, 'Inline encrypted accounting mismatch.');
            const encryptedBytes = actualTransport?.ciphertextBytes ?? compressed.value.length + 28;
            const workerCodecMs = row.components.whole.lz.encodeWorkerRoundTripMs + compressed.roundTripMs + decoded.roundTripMs;
            const preparationMs = wholeSerializeMs + inlineSerializeMs;
            row.components.inline = { lz: { rawBytes: utf8(inlineJson), compressedBytes: compressed.value.length,
              encodeMs: compressed.ms, decodeMs: decoded.ms, encodeWorkerRoundTripMs: compressed.roundTripMs,
              decodeWorkerRoundTripMs: decoded.roundTripMs, exactJsonRoundtrip: true } };
            row.candidates.push({ name: 'existing-inline-lz', status: 'ok', compressedPayloadBytes: compressed.value.length, binaryHeaderBytes: 0,
              framedBytes: compressed.value.length, dataParts: 1, modeledDataAesOverheadBytes: 28,
              modeledDataCiphertextBytes: compressed.value.length + 28, actualTransport, transportObservedMs, transportModelMs,
              encryptedTransferBytes: encryptedBytes, preparationMs,
              encodeMs: row.components.whole.lz.encodeMs + compressed.ms, decodeMs: decoded.ms,
              workerCodecMs, frameAssemblyMs: 0, restoreMs, separateManifest: false, nativeHashIncluded: false,
              // Legacy prepare encodes full logical LZ, then the version-2 inline manifest; it does not use native logical hashes.
              cpuAndLocalMs: preparationMs + workerCodecMs + restoreMs + transportModelMs, exactLogicalRoundtrip: true });
          }
          for (const candidate of row.candidates.filter(candidate => candidate.status === 'ok')) candidate.networkModels = [0, 100].flatMap(rttMs => [10, 50, 100].map(mbps => {
            const wavesPerDirection = Math.ceil(candidate.dataParts / 2) + (candidate.separateManifest ? 1 : 0);
            return { mbps, rttMs, concurrency: 2, wavesPerDirection,
              rttOverheadMs: 2 * rttMs * wavesPerDirection,
              uploadMs: candidate.encryptedTransferBytes * 8 / (mbps * 1000), downloadMs: candidate.encryptedTransferBytes * 8 / (mbps * 1000),
              totalMs: candidate.cpuAndLocalMs + candidate.encryptedTransferBytes * 16 / (mbps * 1000) + 2 * rttMs * wavesPerDirection };
          }));
          row.breakEven = [];
          const successfulCandidates = row.candidates.filter(candidate => candidate.status === 'ok');
          for (let a = 0; a < successfulCandidates.length; a++) for (let b = a + 1; b < successfulCandidates.length; b++) {
            const left = successfulCandidates[a], right = successfulCandidates[b];
            const mbps = 16 * (left.encryptedTransferBytes - right.encryptedTransferBytes) / (1000 * (right.cpuAndLocalMs - left.cpuAndLocalMs));
            const rtt100Mbps = 16 * (left.encryptedTransferBytes - right.encryptedTransferBytes) / (1000 *
              (right.cpuAndLocalMs - left.cpuAndLocalMs + 200 * (right.networkModels[0].wavesPerDirection - left.networkModels[0].wavesPerDirection)));
            row.breakEven.push({ left: left.name, right: right.name, symmetricMbps: Number.isFinite(mbps) && mbps > 0 ? mbps : null,
              rtt100SymmetricMbps: Number.isFinite(rtt100Mbps) && rtt100Mbps > 0 ? rtt100Mbps : null,
              paretoDominant: left.encryptedTransferBytes <= right.encryptedTransferBytes && left.cpuAndLocalMs <= right.cpuAndLocalMs ? left.name :
                right.encryptedTransferBytes <= left.encryptedTransferBytes && right.cpuAndLocalMs <= left.cpuAndLocalMs ? right.name : null });
          }
          row.workerStarts = workerStarts;
          await progress({ caseResult: row });
          }
        }
      }
    } finally { worker.terminate(); URL.revokeObjectURL(workerUrl); }
  }, config);
  report.complete = true; await save(); console.log(JSON.stringify({ report: path, complete: true }));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error); await save();
  console.error(JSON.stringify({ report: path, complete: false, error: report.error })); process.exitCode = 1;
} finally { await browser.close(); }
