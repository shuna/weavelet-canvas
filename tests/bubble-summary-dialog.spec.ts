import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5175', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('summary dialog selects previews, disables empty selection and saves generated summary', async ({ page }) => {
  let requests = 0;
  await page.route('https://summary.test/**', route => ++requests === 1
    ? route.fulfill({ status: 503, body: 'Summary service unavailable' })
    : route.fulfill({ json: { choices: [{ message: { content: 'Generated summary' } }] } }));
  await page.goto('/');
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const contentStore = {};
    const nodes = Object.fromEntries(['a', 'b', 'c'].map((id, index) => [id, { id, parentId: index ? ['a', 'b'][index - 1] : null, role: 'user', createdAt: index, contentHash: addContent(contentStore, [{ type: 'text', text: `Original ${id}` }]) }]));
    const tree = { nodes, rootId: 'a', activePath: ['a', 'b', 'c'] };
    const chat = { ...generateDefaultChat('Summary test'), branchTree: tree, messages: materializeActivePath(tree, contentStore) };
    chat.config.model = 'gpt-4o';
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [chat], currentChatIndex: 0, contentStore, hideSideMenu: true, apiEndpoint: 'https://summary.test/v1/chat/completions', apiKey: 'test', providers: {}, favoriteModels: [], omittedNodeMaps: {}, generatingSessions: {} });
    document.documentElement.classList.add('dark');
  });
  const bubble = page.locator('[data-node-id="b"]').first();
  await bubble.hover();
  await bubble.getByRole('button', { name: '要約を作成', exact: true }).click();
  const modal = page.locator('#modal-root');
  const first = modal.getByRole('checkbox', { name: 'バブル1を要約に含める' });
  const second = modal.getByRole('checkbox', { name: 'バブル2を要約に含める' });
  await expect(second).toBeChecked();
  await expect(first).toBeDisabled();
  const generate = modal.getByRole('button', { name: '要約を生成', exact: true });
  await expect(generate).toBeEnabled();
  const previewStyle = (checkbox: typeof first) => checkbox.locator('..').evaluate(element => ({ color: getComputedStyle(element).color, border: getComputedStyle(element).borderColor }));
  const inactive = await previewStyle(first);
  const active = await previewStyle(second);
  expect(inactive.color).not.toBe(active.color);
  expect(inactive.border).not.toBe(active.border);
  await modal.getByRole('radio', { name: 'ここまで', exact: true }).check();
  await expect(first).toBeChecked();
  expect(await previewStyle(first)).toEqual(active);
  await modal.getByRole('radio', { name: '選択範囲', exact: true }).check();
  await expect(generate).toBeDisabled();
  await expect(generate).toHaveClass(/btn-neutral/);
  await expect(modal.getByText('要約するバブルを選択してください。', { exact: true })).toBeVisible();
  expect(await previewStyle(second)).toEqual(inactive);
  await second.check();
  await expect(generate).toBeEnabled();
  await page.screenshot({ path: '/tmp/weavelet-summary-dialog-fixed.jpg' });
  await generate.click();
  await expect(modal.getByText('Summary service unavailable', { exact: true })).toBeVisible();
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(modal.getByText('要約の対象を選択', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Generated summary', { exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return store.getState().chats[0].summaries;
  });
  expect(saved).toMatchObject([{ text: 'Generated summary', useForSubmit: false, sources: [{ nodeId: 'b' }] }]);
});
