import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const contentStore = {};
    const content = [{ type: 'text', text: Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n') }];
    const tree = { nodes: { root: { id: 'root', parentId: null, role: 'user', createdAt: 0,
      contentHash: addContent(contentStore, content) } }, rootId: 'root', activePath: ['root'] };
    const chat = { ...generateDefaultChat('Collapse test'), branchTree: tree, messages: materializeActivePath(tree, contentStore) };
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [chat], currentChatIndex: 0, contentStore, hideSideMenu: true, markdownMode: true });
  });
});

test('expanding an edited bubble restores its draft and full editor height', async ({ page }) => {
  const bubble = page.locator('[data-node-id="root"]');
  await bubble.hover();
  await bubble.getByRole('button', { name: 'edit message', exact: true }).click();
  const editor = bubble.locator('textarea');
  const draft = Array.from({ length: 15 }, (_, i) => `Draft ${i + 1}`).join('\n');
  await editor.fill(draft);
  const originalEditor = await editor.elementHandle();
  for (let i = 0; i < 3; i++) {
    await bubble.getByRole('button', { name: 'Collapse message', exact: true }).click();
    await expect(editor).toBeHidden();
    await bubble.getByRole('button', { name: 'Expand message', exact: true }).click();
    await expect(editor).toBeVisible();
  }
  expect(await editor.evaluate((el, original) => el === original, originalEditor)).toBe(true);
  await expect(editor).toHaveValue(draft);
  await expect.poll(() => editor.evaluate(el => el.clientHeight)).toBeGreaterThan(350);
  await expect.poll(() => editor.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
});

test('collapsed bubbles retain actions and expand when edit is selected', async ({ page }) => {
  const bubble = page.locator('[data-node-id="root"]');
  await bubble.getByRole('button', { name: 'Collapse message', exact: true }).click();
  await bubble.hover();
  await bubble.getByRole('button', { name: 'edit message', exact: true }).click();
  await expect(bubble.getByRole('button', { name: 'Collapse message', exact: true })).toBeVisible();
  await expect(bubble.locator('textarea')).toHaveValue(/Line 12$/);
  await expect.poll(() => bubble.locator('textarea').evaluate(el => el.clientHeight)).toBeGreaterThan(300);
});
