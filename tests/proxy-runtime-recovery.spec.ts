import { test } from '@playwright/test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('real Workers runtime resumes a disconnected response larger than the recovery window', async ({}, info) => {
  test.setTimeout(45_000);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const proxyBase = 'http://127.0.0.1:8799';
  const worker = spawn(process.execPath, [root + 'proxy-worker/node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', root + 'proxy-worker/wrangler.toml', '--port', '8799'], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
      try { ready = (await fetch(proxyBase + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (ready) break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert(ready, logs);
  const sessionId = `runtime-probe-${Date.now()}`;
  const abort = new AbortController();
  const response = await fetch(`${proxyBase}/api/stream`, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: `http://127.0.0.1:${upstreamPort}/chat`, headers: {}, body: {}, sessionId }) });
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
    const status = await (await fetch(`${proxyBase}/api/status?sessionId=${sessionId}`)).json();
    session = status.sessions.find(s => s.sessionId === sessionId);
    if (session?.cache.terminal === 'complete') break;
  }
  assert.equal(session.cache.terminal, 'complete');
  assert(session.cache.firstEventId > 1);
  assert(cursor >= session.cache.firstEventId - 1);
  assert(session.local.bufferedBytes <= 1048576);
  const replay = await (await fetch(`${proxyBase}/api/recover/${sessionId}?lastEventId=${cursor}`)).text();
  assert(replay.includes('event: done'));
  assert.equal(Number(replay.match(/^id: (\d+)/)?.[1]), cursor + 1);
  const stale = await (await fetch(`${proxyBase}/api/recover/${sessionId}?lastEventId=0`)).text();
  assert(stale.includes('event-id-mismatch'));
  await info.attach('runtime-recovery', { body: JSON.stringify({ receivedBytes: bytes, cursor, firstRetained: session.cache.firstEventId, lastRetained: session.cache.lastEventId, bufferedBytes: session.local.bufferedBytes }), contentType: 'application/json' });
  } finally {
    server.close();
    worker.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { worker.kill('SIGKILL'); resolve(); }, 3000);
      worker.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
});
