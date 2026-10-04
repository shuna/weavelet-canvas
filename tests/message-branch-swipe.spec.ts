import { test, expect } from '@playwright/test';

test.use({
  headless: true,
  baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5175',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE },
});

test('bubble swipe selects the previous/next branch and its continuation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const contentStore = {};
    const nodes = Object.fromEntries([
      ['root', null, 'user', 'shared question'],
      ['a', 'root', 'assistant', 'first answer'],
      ['a-tail', 'a', 'user', 'first continuation'],
      ['b', 'root', 'assistant', 'second answer'],
      ['b-tail', 'b', 'user', 'second continuation'],
    ].map(([id, parentId, role, text], index) => [id, {
      id, parentId, role, createdAt: index,
      contentHash: addContent(contentStore, [{ type: 'text', text }]),
    }]));
    const tree = { nodes, rootId: 'root', activePath: ['root', 'a', 'a-tail'] };
    const chat = { ...generateDefaultChat('Swipe test'), branchTree: tree, messages: materializeActivePath(tree, contentStore) };
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [chat], currentChatIndex: 0, contentStore, hideSideMenu: true, markdownMode: true });
  });

  const path = () => page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return store.getState().chats[0].branchTree.activePath;
  });
  const session = await page.context().newCDPSession(page);
  const swipe = async (nodeId: string, dx: number, dy = 0) => {
    const paragraph = page.locator(`[data-node-id="${nodeId}"] p`).first();
    await paragraph.scrollIntoViewIfNeeded();
    const bounds = (await paragraph.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 4; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 4, y: y + dy * step / 4 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  await expect(page.locator('[data-node-id="a"]')).toContainText('first answer');
  await swipe('a', -100); // Already at the first branch: no wrapping.
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  await swipe('a', 100);
  await expect(page.locator('[data-node-id="b"]')).toContainText('second answer');
  await expect(page.locator('[data-node-id="b-tail"]')).toContainText('second continuation');
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await expect(page.locator('[data-node-id="root"]')).toContainText('shared question');
  await swipe('b', 100); // Last branch also stops.
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await swipe('b', -5, 100); // Vertical scrolling cannot change branches.
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await swipe('b', -100);
  await expect(page.locator('[data-node-id="a-tail"]')).toContainText('first continuation');
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  await page.getByRole('button', { name: 'Next branch', exact: true }).click();
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
});
