import { test, expect, type Page } from '@playwright/test';

test.use({ headless: true, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

async function setupStream(page: Page, initial = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n')) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (initial) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const hookSource = await (await fetch('/src/hooks/useStreamingText.ts')).text();
    const buffer = await load(hookSource.match(/from '([^'\n]*\/streamingBuffer\.ts[^'\n]*)'/)![1]);
    const contentStore = {};
    const content = [{ type: 'text', text: initial }];
    const tree = { nodes: { reply: { id: 'reply', parentId: null, role: 'assistant', createdAt: 0,
      contentHash: addContent(contentStore, content) } }, rootId: 'reply', activePath: ['reply'] };
    const chat = { ...generateDefaultChat('Streaming scroll test'), branchTree: tree, messages: materializeActivePath(tree, contentStore) };
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [chat], currentChatIndex: 0, contentStore, hideSideMenu: true,
      advancedMode: false, markdownMode: true, streamingMarkdownPolicy: 'auto' });
    let text = initial;
    (window as any).streamCheck = {
      advanced: () => store.setState({ advancedMode: true }),
      start: () => {
        buffer.initializeStreamingBuffer(chat.id, 'reply', content);
        store.setState({ generatingSessions: { scroll: { sessionId: 'scroll', chatId: chat.id, targetNodeId: 'reply' } } });
      },
      append: () => {
        const chunk = '\n' + Array.from({ length: 10 }, (_, i) => `More ${i + 1}`).join('\n');
        text += chunk;
        buffer.appendToStreamingBuffer(chat.id, 'reply', chunk);
        buffer.notifyStreamingUpdate(chat.id, 'reply');
      },
      finish: () => {
        const nextContent = [{ type: 'text', text }];
        tree.nodes.reply.contentHash = addContent(contentStore, nextContent);
        store.setState({ contentStore: { ...contentStore }, chats: [{ ...chat, messages: materializeActivePath(tree, contentStore) }], generatingSessions: {} });
        buffer.finalizeStreamingBuffer(chat.id, 'reply');
      },
    };
  }, initial);
  await expect(page.locator('[data-node-id="reply"] .markdown')).toContainText(initial.slice(0, 20));
}

for (const distance of [80, 240]) {
  for (const focused of [false, true]) {
    test(`reading ${distance}px above bottom (input focused: ${focused}) stays in place`, async ({ page }) => {
      await setupStream(page);
      const scroller = page.locator('[data-chat-scroller]');
      if (focused) {
        await page.evaluate(() => (window as any).streamCheck.advanced());
        await scroller.locator('textarea').last().focus();
        await expect(scroller.locator('textarea').last()).toBeFocused();
      }
      await scroller.evaluate(el => new Promise<void>(resolve => {
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await page.evaluate(() => (window as any).streamCheck.start());
      await expect(page.locator('[data-node-id="reply"] .markdown')).toContainText('▌');
      await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
      await scroller.evaluate((el, distance) => { el.scrollTop -= distance; }, distance);
      await page.waitForTimeout(100);
      const before = await scroller.evaluate(el => el.scrollTop);
      expect(before).toBeGreaterThan(0);
      const height = await scroller.evaluate(el => el.scrollHeight);
      await page.evaluate(() => (window as any).streamCheck.append());
      await page.waitForTimeout(350);
      expect(await scroller.evaluate(el => el.scrollHeight)).toBeGreaterThan(height);
      expect(await scroller.evaluate(el => el.scrollTop)).toBeCloseTo(before, 0);
      await page.evaluate(() => (window as any).streamCheck.finish());
      await expect(page.locator('[data-node-id="reply"] .markdown p').last()).toContainText('More 10');
      await page.waitForTimeout(350);
      expect(await scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(before);
      expect(await scroller.evaluate(el => el.scrollTop)).toBeCloseTo(before, 0);
    });
  }
}

test('bottom follows growth and final Markdown layout', async ({ page }) => {
  await setupStream(page);
  const scroller = page.locator('[data-chat-scroller]');
  await scroller.evaluate(el => new Promise<void>(resolve => {
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.evaluate(() => (window as any).streamCheck.start());
  await expect(page.locator('[data-node-id="reply"] .markdown')).toContainText('▌');
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      (window as any).streamCheck.append();
      await new Promise(requestAnimationFrame);
    }
  });
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => (window as any).streamCheck.finish());
  await expect(page.locator('[data-node-id="reply"] .markdown p').last()).toContainText('More 10');
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
});

test('a short conversation stays fixed when the response outgrows the viewport', async ({ page }) => {
  await setupStream(page, '受信を開始しました。');
  const scroller = page.locator('[data-chat-scroller]');
  expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
  expect(await scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0.5);
  await page.evaluate(() => (window as any).streamCheck.start());
  await expect(page.locator('[data-node-id="reply"] .markdown')).toContainText('▌');
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      (window as any).streamCheck.append();
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  });
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
  await page.waitForTimeout(100);
  expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
  await page.evaluate(() => (window as any).streamCheck.finish());
  await expect(page.locator('[data-node-id="reply"] .markdown p').last()).toContainText('More 10');
  await page.waitForTimeout(100);
  expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
});
