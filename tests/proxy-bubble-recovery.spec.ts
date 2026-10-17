import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('bubble recovery survives reload and restores only the selected request', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const { createPersistedChatDataState } = await load('/src/store/persistence.ts');
    const { saveChatData } = await load('/src/store/storage/IndexedDbStorage.ts');
    const contentStore = {};
    const nodes: Record<string, any> = {};
    ['root', 'a', 'b'].forEach((id, index, ids) => {
      nodes[id] = { id, parentId: ids[index - 1] ?? null, role: index ? 'assistant' : 'user', createdAt: Date.now(),
        contentHash: addContent(contentStore, [{ type: 'text', text: index ? `partial ${id}` : 'question' }]),
        ...(index ? { streamState: { reason: 'error', requestId: `request-${id}`, proxy: true, createdAt: Date.now() } } : {}) };
    });
    const tree = { rootId: 'root', activePath: ['root', 'a', 'b'], nodes };
    const chat = { ...generateDefaultChat('Proxy recovery'), id: 'recovery-chat', branchTree: tree, messages: materializeActivePath(tree, contentStore) };
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [chat], currentChatIndex: 0, contentStore, hideSideMenu: true, error: '',
      generatingSessions: {}, proxyEnabled: true, proxyEndpoint: 'https://proxy.test', proxyAuthToken: '' });
    await saveChatData(createPersistedChatDataState(store.getState()));
  });
  const bubbleA = page.locator('[data-node-id="a"]');
  const bubbleB = page.locator('[data-node-id="b"]');
  await expect(bubbleA.getByRole('button', { name: 'プロキシから復旧', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(bubbleA.getByText('送信エラー', { exact: true })).toBeVisible();
  await expect(bubbleB.getByRole('button', { name: 'プロキシから復旧', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { saveRequest } = await load('/src/utils/streamDb.ts');
    for (const id of ['a', 'b']) {
      const node = store.getState().chats[0].branchTree.nodes[id];
      await saveRequest({ requestId: `request-${id}`, chatId: 'recovery-chat', nodeId: id,
        checkpointHash: node.contentHash, checkpointRole: 'assistant', chatIndex: 0, messageIndex: id === 'a' ? 1 : 2,
        bufferedText: `partial ${id}`, status: 'failed', createdAt: Date.now(), updatedAt: Date.now(), acknowledged: false,
        proxySessionId: `session-${id}`, lastProxyEventId: 0 });
    }
  });
  const recovered: string[] = [];
  await page.route('https://proxy.test/api/recover/**', async route => {
    recovered.push(route.request().url());
    const raw = 'data: {"choices":[{"delta":{"content":" restored"}}]}\n\ndata: [DONE]\n\n';
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'Access-Control-Allow-Origin': '*' },
      body: `id: 1\ndata: ${JSON.stringify(raw)}\n\nevent: done\ndata: {"complete":true}\n\n` });
  });
  await page.route('https://proxy.test/api/ack/**', route => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"deleted":true}' }));
  await bubbleA.getByRole('button', { name: 'プロキシから復旧', exact: true }).click();
  await expect(bubbleA.getByText('プロキシから復元済み', { exact: true })).toBeVisible();
  await expect(bubbleA).toContainText('partial a restored');
  await expect(bubbleA.getByRole('button', { name: 'プロキシから復旧', exact: true })).toHaveCount(0);
  await expect(bubbleB).toContainText('partial b');
  await expect(bubbleB.getByRole('button', { name: 'プロキシから復旧', exact: true })).toBeVisible();
  expect(recovered).toEqual(['https://proxy.test/api/recover/session-a?lastEventId=0']);
  await page.screenshot({ path: '/tmp/weavelet-proxy-bubbles.png', fullPage: true });
});
