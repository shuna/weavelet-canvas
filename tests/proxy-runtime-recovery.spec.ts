import { test } from '@playwright/test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real Workers runtime resumes a disconnected response larger than the recovery window', async ({}, info) => {
  test.setTimeout(45_000);
  const proxyFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers); headers.set('Authorization', 'Bearer runtime-test');
    return globalThis.fetch(input, { ...init, headers });
  };
  const root = fileURLToPath(new URL('../', import.meta.url));
  const proxyBase = 'http://127.0.0.1:8799';
  const persist = await mkdtemp(join(tmpdir(), 'weavelet-recovery-'));
  const startWorker = () => spawn(process.execPath, [root + 'proxy-worker/node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', root + 'proxy-worker/wrangler.toml', '--port', '8799', '--persist-to', persist, '--var', 'PROXY_AUTH_TOKEN:runtime-test'], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let worker = startWorker();
  let logs = '';
  worker.stdout.on('data', data => { logs = (logs + data).slice(-4000); });
  worker.stderr.on('data', data => { logs = (logs + data).slice(-4000); });
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let count = 0;
  const timer = setInterval(() => {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: String(count++).padStart(4, '0') + 'x'.repeat(8192) } }] })}\n\n`);
    if (count === 300) { clearInterval(timer); res.end('data: [DONE]\n\n'); }
  }, 2);
  res.on('close', () => clearInterval(timer));
});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (server.address() as { port: number }).port;
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (worker.exitCode !== null) throw new Error(logs);
      try { ready = (await proxyFetch(proxyBase + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (ready) break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert(ready, logs);
  const sessionId = `runtime-probe-${Date.now()}`;
  const abort = new AbortController();
  const response = await proxyFetch(`${proxyBase}/api/stream`, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: `http://127.0.0.1:${upstreamPort}/chat`, headers: {}, body: {}, sessionId }) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let bytes = 0, cursor = 0, partial = '';
  const decoder = new TextDecoder();
  while (bytes < 1_900_000) {
    const { value, done } = await reader.read();
    assert(!done);
    bytes += value.byteLength;
    const blocks = (partial + decoder.decode(value, { stream: true })).split('\n\n');
    partial = blocks.pop() ?? '';
    for (const block of blocks) { const match = block.match(/^id: (\d+)/); if (match) cursor = Number(match[1]); }
  }
  abort.abort();
  await reader.cancel().catch(() => {});
  let session: any;
  for (let n = 0; n < 80; n++) {
    await new Promise(r => setTimeout(r, 100));
    const status = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${sessionId}`)).json();
    session = status.sessions.find(s => s.sessionId === sessionId);
    if (session?.cache.terminal === 'complete') break;
  }
  assert.equal(session.cache.terminal, 'complete');
  // Restart the entire runtime: no isolate memory or Cache API entry can supply recovery.
  worker.kill('SIGTERM');
  await new Promise<void>(resolve => worker.once('exit', () => resolve()));
  worker = startWorker();
  worker.stdout.on('data', data => { logs = (logs + data).slice(-4000); });
  worker.stderr.on('data', data => { logs = (logs + data).slice(-4000); });
  let restored: any;
  for (let n = 0; n < 100; n++) {
    try {
      const result = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${sessionId}`, { signal: AbortSignal.timeout(500) })).json();
      restored = result.sessions[0];
      assert.equal(result.scope, 'durable-session');
      break;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(restored?.local?.phase, 'complete', logs);
  assert.equal(restored.cache.lastEventId, session.cache.lastEventId);
  session = restored;
  assert(session.cache.firstEventId > 1);
  assert(cursor >= session.cache.firstEventId - 1);
  assert(session.local.bufferedBytes <= 1048576);
  const replay = await (await proxyFetch(`${proxyBase}/api/recover/${sessionId}?lastEventId=${cursor}`)).text();
  assert(replay.includes('event: done'));
  assert.equal(Number(replay.match(/^id: (\d+)/)?.[1]), cursor + 1);
  const stale = await (await proxyFetch(`${proxyBase}/api/recover/${sessionId}?lastEventId=0`)).text();
  assert(stale.includes('event-id-mismatch'));
  const duplicate = await proxyFetch(`${proxyBase}/api/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: `http://127.0.0.1:${upstreamPort}/chat`, headers: {}, body: {}, sessionId }) });
  assert.equal(duplicate.status, 409);
  const failedId = `${sessionId}-failed`;
  const failed = await proxyFetch(`${proxyBase}/api/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://127.0.0.1:1/unreachable', headers: {}, body: {}, sessionId: failedId }) });
  assert.equal(failed.status, 502);
  const failureStatus = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${failedId}`)).json();
  assert.equal(failureStatus.sessions[0].local.reason, 'upstream-connection-error');
  assert.equal(failureStatus.sessions[0].cache.state, 'not-saved');
  const ack = await proxyFetch(`${proxyBase}/api/ack/${sessionId}`, { method: 'POST' });
  assert(ack.ok);
  const acknowledged = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${sessionId}`)).json();
  assert.equal(acknowledged.sessions[0].cache.state, 'acknowledged');
  const missing = await (await proxyFetch(`${proxyBase}/api/status?sessionId=unknown-${Date.now()}`)).json();
  assert.equal(missing.sessions[0].cache.state, 'not-recorded');
  const individuallyDeleted = await proxyFetch(`${proxyBase}/api/storage/${failedId}`, { method: 'DELETE' });
  assert(individuallyDeleted.ok);
  const afterSingle = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${failedId}`)).json();
  assert.equal(afterSingle.sessions[0].local, null);
  assert.equal(afterSingle.sessions[0].cache.state, 'not-recorded');
  const activeId = `${sessionId}-active`;
  const activeResponse = await proxyFetch(`${proxyBase}/api/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: `http://127.0.0.1:${upstreamPort}/chat`, headers: {}, body: {}, sessionId: activeId }) });
  assert(activeResponse.ok);
  const activeOutput = activeResponse.text();
  assert((await proxyFetch(`${proxyBase}/api/storage/${activeId}`, { method: 'DELETE' })).ok);
  await activeOutput;
  const afterActiveDeletion = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${activeId}`)).json();
  assert.equal(afterActiveDeletion.sessions[0].local, null);
  assert.equal(afterActiveDeletion.sessions[0].cache.state, 'not-recorded');
  // Include records never queried by the status view, exceeding its 20-item page.
  await Promise.all(Array.from({ length: 23 }, async (_, n) => {
    const result = await proxyFetch(`${proxyBase}/api/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://127.0.0.1:1/unreachable', headers: {}, body: {}, sessionId: `${sessionId}-hidden-${n}` }) });
    assert.equal(result.status, 502);
  }));
  const globallyListed: string[] = [];
  let statusCursor: string | null = null, statusPages = 0;
  do {
    const query = new URLSearchParams({ all: '1' });
    if (statusCursor) query.set('cursor', statusCursor);
    const result = await proxyFetch(`${proxyBase}/api/status?${query}`);
    assert(result.ok);
    const page = await result.json();
    assert.equal(page.scope, 'all-sessions');
    assert.equal(page.unavailableSessions, 0);
    globallyListed.push(...page.sessions.map(s => s.sessionId));
    statusCursor = page.nextCursor; statusPages++;
  } while (statusCursor);
  assert.equal(new Set(globallyListed).size, 24);
  for (let n = 0; n < 23; n++) assert(globallyListed.includes(`${sessionId}-hidden-${n}`));
  assert(globallyListed.includes(sessionId));
  assert(statusPages >= 2);
  assert.equal((await fetch(`${proxyBase}/api/status?all=1`)).status, 401);
  let deletionCursor: string | null = null, cutoff: number | undefined, totalDeleted = 0, pages = 0;
  do {
    const query = new URLSearchParams();
    if (cutoff !== undefined) query.set('before', String(cutoff));
    if (deletionCursor) query.set('cursor', deletionCursor);
    const result = await proxyFetch(`${proxyBase}/api/storage?${query}`, { method: 'DELETE' });
    assert(result.ok);
    const progress = await result.json();
    assert.equal(progress.failed, 0);
    cutoff = progress.before; deletionCursor = progress.cursor; totalDeleted += progress.deleted; pages++;
  } while (deletionCursor);
  assert.equal(totalDeleted, 24); // 23 hidden failures plus the acknowledged response.
  assert(pages >= 2);
  const afterAll = await (await proxyFetch(`${proxyBase}/api/status?sessionId=${sessionId}&sessionId=${sessionId}-hidden-22`)).json();
  assert(afterAll.sessions.every(s => s.local === null && s.cache.state === 'not-recorded'));
  await info.attach('runtime-recovery', { body: JSON.stringify({ receivedBytes: bytes, cursor, firstRetained: session.cache.firstEventId, lastRetained: session.cache.lastEventId, bufferedBytes: session.local.bufferedBytes }), contentType: 'application/json' });
  } finally {
    server.close();
    worker.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { worker.kill('SIGKILL'); resolve(); }, 3000);
      worker.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await rm(persist, { recursive: true, force: true });
  }
});
