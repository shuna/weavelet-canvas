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
      ['b-tail', 'b', 'user', 'second continuation\n' + 'A longer continuation keeps the branch height different.\n'.repeat(8)],
    ].map(([id, parentId, role, text], index) => [id, {
      id, parentId, role, createdAt: index,
      contentHash: addContent(contentStore, [{ type: 'text', text }]),
    }]));
    const tree = { nodes, rootId: 'root', activePath: ['root', 'a', 'a-tail'] };
    const chat = { ...generateDefaultChat('Swipe test'), branchTree: tree, messages: materializeActivePath(tree, contentStore) };
    store.getState().setOnboardingCompleted(true);
    if (store.getState().branchSwipeDirection !== 'left-next') throw new Error('Default must select next on left swipe');
    store.getState().setBranchSwipeDirection('right-next');
    store.setState({ chats: [chat], currentChatIndex: 0, contentStore, hideSideMenu: true, markdownMode: true });
  });

  const path = () => page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return store.getState().chats[0].branchTree.activePath;
  });
  const session = await page.context().newCDPSession(page);
  const beginTouch = async (nodeId: string) => {
    const paragraph = page.locator(`[data-node-id="${nodeId}"] p`).first();
    await paragraph.scrollIntoViewIfNeeded();
    const bounds = (await paragraph.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    return { x, y };
  };
  const moveTouch = async (point: { x: number; y: number }, dx: number, dy = 0) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + dx, y: point.y + dy }] });
  };
  const endTouch = async () => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const waitForRest = () => expect(page.locator('[data-chat-scroller]')).not.toHaveAttribute('data-branch-swiping');
  const branchHistory = () => page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    const state = store.getState();
    return [...state.navHistoryPast, state.navHistoryCurrent].filter(entry => entry?.source === 'branch-switch').length;
  });
  const swipe = async (nodeId: string, dx: number, dy = 0) => {
    const point = await beginTouch(nodeId);
    for (let step = 1; step <= 4; step++) {
      await moveTouch(point, dx * step / 4, dy * step / 4);
    }
    await endTouch();
    await waitForRest();
  };

  await expect(page.locator('[data-node-id="a"]')).toContainText('first answer');
  const rootX = (await page.locator('[data-node-id="root"]').boundingBox())!.x;
  const historyBefore = await branchHistory();
  const origin = await beginTouch('a');
  await moveTouch(origin, 130);
  await expect(page.locator('[data-branch-swipe-preview]')).toContainText('second answer');
  await expect(page.locator('[data-branch-swipe-preview]')).toContainText('second continuation');
  const movingX = (await page.locator('[data-node-id="a"]').boundingBox())!.x;
  expect(movingX).toBeGreaterThan(100);
  expect((await page.locator('[data-node-id="a-tail"]').boundingBox())!.x).toBeCloseTo(movingX, 0);
  expect((await page.locator('[data-node-id="root"]').boundingBox())!.x).toBe(rootX);
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  expect(await branchHistory()).toBe(historyBefore);
  await moveTouch(origin, 40); // Cross the threshold, then return below it.
  await page.waitForTimeout(150); // A held drag is not a flick.
  await endTouch();
  await waitForRest();
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  expect(await branchHistory()).toBe(historyBefore);
  expect((await page.locator('[data-node-id="a"]').boundingBox())!.x).toBeCloseTo(0, 0);
  await swipe('a', -100); // Already at the first branch: no wrapping.
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  const commitOrigin = await beginTouch('a');
  const oldTop = (await page.locator('[data-node-id="a"]').boundingBox())!.y;
  await moveTouch(commitOrigin, 130);
  await page.waitForTimeout(150);
  await endTouch();
  expect(await path()).toEqual(['root', 'a', 'a-tail']); // Commit after animation.
  await waitForRest();
  await expect(page.locator('[data-node-id="b"]')).toContainText('second answer');
  await expect(page.locator('[data-node-id="b-tail"]')).toContainText('second continuation');
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  expect((await page.locator('[data-node-id="b"]').boundingBox())!.y).toBeCloseTo(oldTop, 0);
  expect(await branchHistory()).toBe(historyBefore + 1);
  await expect(page.locator('[data-node-id="root"]')).toContainText('shared question');
  await swipe('b', 100); // Last branch also stops.
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await swipe('b', -5, 100); // Vertical scrolling cannot change branches.
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await swipe('b', -130);
  await expect(page.locator('[data-node-id="a-tail"]')).toContainText('first continuation');
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  await page.getByRole('button', { name: 'Next branch', exact: true }).click();
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await swipe('b', -130);
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  await expect(page.locator('[data-branch-swipe-preview]')).toHaveCount(0);
  expect(await page.locator('[data-message-list]').evaluate(element => (element as HTMLElement).style.height)).toBe('');

  await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    const { default: i18n } = await import(/* @vite-ignore */ '/src/i18n.ts');
    await i18n.changeLanguage('ja');
    store.getState().setHideMenuOptions(false);
    store.getState().setHideSideMenu(false);
  });
  await page.getByText('設定', { exact: true }).click();
  const directionSelect = page.getByLabel('分岐スワイプの方向', { exact: true });
  await expect(directionSelect).toHaveValue('right-next');
  await directionSelect.selectOption('left-next');
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    store.getState().setHideSideMenu(true);
  });
  await expect(directionSelect).toHaveCount(0);
  await expect.poll(() => page.locator('#menu').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await swipe('a', -130);
  expect(await path()).toEqual(['root', 'b', 'b-tail']);
  await swipe('b', 130);
  expect(await path()).toEqual(['root', 'a', 'a-tail']);
  await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    store.getState().setHideSideMenu(false);
  });
  await page.getByText('設定', { exact: true }).click();
  await directionSelect.selectOption('right-next');
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return store.getState().branchSwipeDirection;
  })).toBe('right-next');
});
