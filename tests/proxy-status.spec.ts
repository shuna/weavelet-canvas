import { test, expect } from '@playwright/test';
test.use({ headless: true, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5175', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('inspects server metadata against local cursors and displays missing data and authentication errors', async ({ page }) => {
  let unauthorized = false;
  let durable = false;
  const deleted = new Set<string>();
  let allDeleted = false, deleteCalls = 0;
  await page.route('https://proxy.test/api/storage**', async route => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().headers().authorization).toBe('Bearer private-token');
    deleteCalls++;
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/storage') { allDeleted = true; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ deleted: 3, failed: 0, before: 100, cursor: null }) }); }
    deleted.add(decodeURIComponent(path.slice('/api/storage/'.length)));
    await route.fulfill({ contentType: 'application/json', body: '{"deleted":true}' });
  });
  let lookedUpManualId = false;
  await page.route('https://proxy.test/api/status**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer private-token');
    expect(route.request().url()).not.toContain('private-token');
    if (unauthorized) return route.fulfill({ status: 401, body: '{"error":"Unauthorized"}' });
    const query = new URL(route.request().url()).searchParams;
    const ids = query.getAll('sessionId');
    const all = query.get('all') === '1';
    lookedUpManualId ||= ids.includes('other-device-session');
    const session = (id: string, first: number) => allDeleted || deleted.has(id) ? { sessionId: id, local: null, cache: { state: 'not-recorded' } } : ({ sessionId: id,
      local: { sessionId: id, startedAt: Date.now(), updatedAt: Date.now(), lastChunkAt: Date.now(), phase: 'interrupted', lastEventId: 20, firstEventId: first, receivedBytes: 2200000, bufferedBytes: 1000000, cacheWrites: 4, cacheFailures: 1, reason: 'upstream-idle-timeout' },
      cache: { state: 'available', firstEventId: first, lastEventId: 20, terminal: 'interrupted', expiresAt: Date.now() + 300000, updatedAt: Date.now() } });
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ version: '0.3.0', checkedAt: Date.now(), colo: 'NRT', instanceId: 'diagnostic-instance', scope: all ? 'all-sessions' : 'durable-session', storageDeletion: { individual: true, all: true }, limits: { cacheBytes: 1048576, retentionMs: 300000, idleTimeoutMs: 45000 }, sessions: [session('session-a', 10), session('session-b', 1), ...(lookedUpManualId ? [{ sessionId: 'other-device-session', local: null, cache: { state: durable ? 'not-recorded' : 'missing' } }] : [])] }) });
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const { saveRequest } = await load('/src/utils/streamDb.ts');
    const contentStore = {};
    const nodes: Record<string, any> = {};
    ['a', 'b'].forEach((id, n) => { nodes[id] = { id, parentId: n ? 'a' : null, role: 'assistant', createdAt: Date.now(), contentHash: addContent(contentStore, [{ type: 'text', text: 'partial' }]) }; });
    const tree = { rootId: 'a', activePath: ['a', 'b'], nodes };
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [{ ...generateDefaultChat('Diagnostics'), id: 'diagnostics', branchTree: tree, messages: materializeActivePath(tree, contentStore) }], currentChatIndex: 0, contentStore, generatingSessions: {}, proxyEnabled: true, proxyEndpoint: 'https://proxy.test', proxyAuthToken: 'private-token' });
    for (const id of ['a', 'b']) await saveRequest({ requestId: `request-${id}`, chatId: 'diagnostics', nodeId: id, checkpointHash: nodes[id].contentHash, checkpointRole: 'assistant', chatIndex: 0, messageIndex: id === 'a' ? 0 : 1, bufferedText: 'partial', status: 'failed', createdAt: Date.now(), updatedAt: Date.now(), acknowledged: false, proxySessionId: `session-${id}`, lastProxyEventId: 3 });
    store.getState().setShowProxySettings(true);
  });
  await page.getByRole('button', { name: 'プロキシの状態を確認', exact: true }).click();
  await expect(page.getByText(/Worker 0.3.0/)).toBeVisible();
  const gap = page.locator('section').filter({ has: page.getByText('session-a', { exact: true }) });
  const retained = page.locator('section').filter({ has: page.getByText('session-b', { exact: true }) });
  await expect(gap).toContainText('欠落なく復旧することはできません');
  await expect(gap.getByRole('button', { name: 'このリクエストを復旧' })).toBeDisabled();
  await expect(retained.getByRole('button', { name: 'このリクエストを復旧' })).toBeEnabled();
  await expect(retained).toContainText('upstream-idle-timeout');
  await page.getByRole('textbox', { name: '調べるプロキシセッションID' }).fill('other-device-session');
  await page.getByRole('button', { name: '照会', exact: true }).click();
  await expect(page.getByText('other-device-session', { exact: true })).toBeVisible();
  await expect(page.getByText('保存データなし', { exact: false }).last()).toBeVisible();
  await page.screenshot({ path: '/tmp/weavelet-proxy-status.png', fullPage: true });
  durable = true;
  await page.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByText(/指定したIDの永続保存先/)).toBeVisible();
  await expect(page.getByText(/サーバーに受付記録がありません/)).toBeVisible();
  await expect(page.getByText('復旧データ: サーバー記録なし')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await gap.getByRole('button', { name: 'この保存データを削除', exact: true }).click();
  expect(deleteCalls).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await gap.getByRole('button', { name: 'この保存データを削除', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('このリクエストの保存データを削除しました');
  await expect(gap).toContainText('復旧データ: サーバー記録なし');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('全端末'); await dialog.accept(); });
  await page.getByRole('button', { name: 'プロキシの全保存データを削除', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('3件の保存データを削除しました');
  await expect(retained).toContainText('復旧データ: サーバー記録なし');
  expect(deleteCalls).toBe(2);
  const localRecords = await page.evaluate(async () => { const load = (path: string) => import(/* @vite-ignore */ path); return (await (await load('/src/utils/streamDb.ts')).getAllPending()).length; });
  expect(localRecords).toBe(2);
  unauthorized = true;
  await page.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('認証に失敗');
});

test('browses server records from other runtimes without local recovery records', async ({ page }) => {
  const cursor = 'session:' + 'b'.repeat(64);
  const requests: string[] = [];
  await page.route('https://global-proxy.test/api/status**', async route => {
    const url = new URL(route.request().url()); requests.push(url.search);
    expect(url.searchParams.get('all')).toBe('1');
    expect(url.searchParams.getAll('sessionId')).toEqual([]);
    expect(route.request().headers().authorization).toBe('Bearer global-token');
    const second = url.searchParams.get('cursor') === cursor;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '0.6.0', checkedAt: Date.now(), colo: 'NRT', instanceId: 'all-instances', scope: 'all-sessions', recentSessionsVisible: true, nextCursor: second ? null : cursor, limits: { cacheBytes: 1048576, retentionMs: 300000, idleTimeoutMs: 45000 }, sessions: [{ sessionId: second ? 'another-runtime-page-two' : 'other-device-server-record', local: null, cache: { state: 'available', terminal: 'complete', firstEventId: 1, lastEventId: 10 } }] }) });
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    store.getState().setOnboardingCompleted(true);
    store.setState({ proxyEnabled: true, proxyEndpoint: 'https://global-proxy.test', proxyAuthToken: 'global-token' });
    store.getState().setShowProxySettings(true);
  });
  await page.getByRole('button', { name: 'プロキシの状態を確認', exact: true }).click();
  await expect(page.getByText('other-device-server-record', { exact: true })).toBeVisible();
  await expect(page.getByText(/全端末・全実行環境の保存記録/)).toBeVisible();
  await expect(page.getByText('この端末に記録なし', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '前の20件', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '次の20件', exact: true }).click();
  await expect(page.getByText('another-runtime-page-two', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '次の20件', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '前の20件', exact: true }).click();
  await expect(page.getByText('other-device-server-record', { exact: true })).toBeVisible();
  expect(requests.some(query => query.includes('cursor='))).toBe(true);
});
