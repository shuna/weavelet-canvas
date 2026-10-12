import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
test.use({ headless: true, actionTimeout: 10_000, locale: 'ja-JP', baseURL: process.env.WEAVELET_TEST_URL ?? 'http://127.0.0.1:5189',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

async function fixture(page: Page) {
  await page.goto('/');
  await page.locator('#menu').waitFor({ state: 'attached' });
  const source = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { addContent } = await load('/src/utils/contentStore.ts');
    const { materializeActivePath } = await load('/src/utils/branchUtils.ts');
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const contentStore = {};
    const chats = ['File alpha', 'File beta', 'File gamma'].map((title, index) => {
      const nodes = Object.fromEntries([
        ['root', null, 'user', `Question ${index}`],
        ['a', 'root', 'assistant', `Visible answer ${index}`],
        ['b', 'root', 'assistant', `Hidden branch needle ${index}`],
      ].map(([id, parentId, role, text]) => [id, { id, parentId, role, createdAt: 0,
        contentHash: addContent(contentStore, [{ type: 'text', text }]) }]));
      const tree = { nodes, rootId: 'root', activePath: ['root', 'a'] };
      return { ...generateDefaultChat(title), id: `source-${index}`, folder: index === 0 ? 'nested-folder' : index === 1 ? 'file-folder' : undefined, branchTree: tree,
        messages: materializeActivePath(tree, contentStore) };
    });
    const liveContent = {};
    const tree = { nodes: { root: { id: 'root', parentId: null, role: 'user', createdAt: 0,
      contentHash: addContent(liveContent, [{ type: 'text', text: 'Live workspace content' }]) } },
      rootId: 'root', activePath: ['root'] };
    const live = { ...generateDefaultChat('Live selected chat'), id: chats[0].id, branchTree: tree,
      messages: materializeActivePath(tree, liveContent) };
    store.getState().setOnboardingCompleted(true);
    store.setState({ chats: [live], contentStore: liveContent, currentChatIndex: 0,
      folders: {}, hideSideMenu: false, hideMenuOptions: false, markdownMode: true, chatActiveView: 'chat' });
    return { version: 3, chats, contentStore, folders: {
      'file-folder': { id: 'file-folder', name: 'File folder', order: 0, expanded: false },
      'nested-folder': { id: 'nested-folder', name: 'Nested folder', parentId: 'file-folder', order: 1, expanded: false },
      'empty-child': { id: 'empty-child', name: 'Empty child', parentId: 'file-folder', order: 2, expanded: true },
      'empty-top': { id: 'empty-top', name: 'Untouched empty', order: 3, expanded: true },
    } };
  });
  await expect(page.locator('[data-chat-scroller]')).toContainText('Live workspace content');
  return source;
}

async function openFile(page: Page, source: unknown) {
  await page.locator('#menu').getByText('インポート / エクスポート', { exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').first().setInputFiles({
    name: 'browse-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.getByRole('button', { name: 'Browse import file', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toBeVisible();
}

async function liveSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    const state = store.getState();
    return JSON.stringify({ chats: state.chats, contentStore: state.contentStore, folders: state.folders,
      currentChatIndex: state.currentChatIndex, navHistoryPast: state.navHistoryPast,
      navHistoryCurrent: state.navHistoryCurrent, navHistoryFuture: state.navHistoryFuture,
      multiViewChatIndices: state.multiViewChatIndices,
      localSelection: localStorage.getItem('currentChatIndex'), nativeHistoryLength: history.length });
  });
}

test('preview uses existing search and branch UI while cancel preserves the live workspace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = await fixture(page);
  await page.locator('#menu').getByText('Live selected chat', { exact: true }).locator('..').locator('div').first().hover();
  await page.locator('#menu').getByRole('checkbox', { name: 'Select chat: Live selected chat', exact: true }).check();
  await openFile(page, source);
  const before = await liveSnapshot(page);
  const sidebar = page.locator('#menu');
  await expect(sidebar.getByRole('checkbox', { name: /^Select chat:/ })).toHaveCount(3);
  for (const checkbox of await sidebar.getByRole('checkbox', { name: /^Select chat:/ }).all()) await expect(checkbox).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import selected chats', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'edit message', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'edit chat title', exact: true })).toHaveCount(0);
  await expect(sidebar.getByText('新規会話', { exact: true })).toHaveCount(0);
  await sidebar.getByTitle('本文検索 (grep)', { exact: true }).click();
  await sidebar.getByPlaceholder('検索').fill('Hidden branch needle 0');
  await sidebar.getByText('Hidden branch needle 0', { exact: false }).last().click();
  await expect(page.locator('[data-chat-scroller]')).toContainText('Hidden branch needle 0');
  await page.getByRole('button', { name: '分岐エディタ', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  await page.locator('.react-flow__node').filter({ hasText: 'Hidden branch needle 0' }).first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'ラベルを編集', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'ブランチを削除', exact: true })).toHaveCount(0);
  await page.locator('.fixed.inset-0.z-40').click({ position: { x: 350, y: 200 } });
  const nodeCount = await page.locator('.react-flow__node').count();
  await page.locator('.react-flow').click({ position: { x: 350, y: 200 } });
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+x');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.react-flow__node')).toHaveCount(nodeCount);
  expect(await liveSnapshot(page)).toBe(before);
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-chat-scroller]')).toContainText('Live workspace content');
  await expect(page.locator('#menu').getByRole('checkbox', { name: 'Select chat: Live selected chat', exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});

test('filtered selection imports only selected complete chats and retains live selection', async ({ page }) => {
  const source = await fixture(page);
  await openFile(page, source);
  await page.getByRole('button', { name: 'Next branch', exact: true }).click();
  await expect(page.locator('[data-chat-scroller]')).toContainText('Hidden branch needle 0');
  const sidebar = page.locator('#menu');
  await sidebar.getByRole('checkbox', { name: 'Select chat: File alpha', exact: true }).check();
  await sidebar.getByRole('checkbox', { name: 'Select chat: File beta', exact: true }).check();
  await sidebar.getByPlaceholder('検索').fill('File gamma');
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toContainText(/チャット\s*2\s*件/);
  // The live workspace can change while the user is browsing the file.
  await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    store.getState().renameChat({ chatId: 'source-0', title: 'Live updated while browsing' });
  });
  await page.getByRole('button', { name: 'Import selected chats', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    const state = store.getState();
    return { selected: state.chats[state.currentChatIndex].id, folders: Object.values(state.folders),
      chats: state.chats.map(chat => ({ id: chat.id, title: chat.title, folder: chat.folder,
        activePath: chat.branchTree.activePath, nodes: Object.keys(chat.branchTree.nodes) })) };
  });
  expect(result.selected).toBe('source-0');
  expect(result.chats.map(chat => chat.title)).toEqual(expect.arrayContaining([
    'File alpha', 'File beta', 'Live updated while browsing',
  ]));
  expect(result.chats).toHaveLength(3);
  expect(new Set(result.chats.map(chat => chat.id)).size).toBe(3);
  const group = result.folders.find(folder => folder.name.includes('browse-fixture.json'))!;
  const parent = result.folders.find(folder => folder.name === 'File folder')!;
  const child = result.folders.find(folder => folder.name === 'Nested folder')!;
  expect(parent.parentId).toBe(group.id);
  expect(child.parentId).toBe(parent.id);
  expect(parent.expanded).toBe(false);
  expect(child.expanded).toBe(false);
  expect(result.chats.find(chat => chat.title === 'File alpha')!.folder).toBe(child.id);
  expect(result.chats.find(chat => chat.title === 'File beta')!.folder).toBe(parent.id);
  expect(result.folders.map(folder => folder.name)).not.toContain('Empty child');
  expect(result.folders.map(folder => folder.name)).not.toContain('Untouched empty');
  for (const chat of result.chats.filter(chat => chat.id !== 'source-0')) {
    expect(chat.activePath).toEqual(['root', 'a']);
    expect(chat.nodes).toEqual(expect.arrayContaining(['root', 'a', 'b']));
  }
});

test('folder selection includes nested empty folders but respects an individually deselected chat', async ({ page }) => {
  const source = await fixture(page);
  await openFile(page, source);
  const sidebar = page.locator('#menu');
  const folder = sidebar.getByRole('checkbox', { name: 'Select folder: File folder', exact: true });
  await folder.check();
  await expect(sidebar.getByRole('checkbox', { name: 'Select chat: File alpha', exact: true })).toBeChecked();
  await expect(sidebar.getByRole('checkbox', { name: 'Select chat: File beta', exact: true })).toBeChecked();
  await expect(sidebar.getByRole('checkbox', { name: 'Select folder: Empty child', exact: true })).toBeChecked();
  await expect(sidebar.getByRole('checkbox', { name: 'Select chat: File gamma', exact: true })).not.toBeChecked();
  await sidebar.getByRole('checkbox', { name: 'Select chat: File beta', exact: true }).uncheck();
  await expect.poll(() => folder.evaluate((element: HTMLInputElement) => element.indeterminate)).toBe(true);
  await sidebar.getByPlaceholder('検索').fill('File gamma');
  await page.getByRole('button', { name: 'Import selected chats', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return { titles: store.getState().chats.map(chat => chat.title), folders: Object.values(store.getState().folders) };
  });
  expect(result.titles).toEqual(expect.arrayContaining(['File alpha', 'Live selected chat']));
  expect(result.titles).not.toContain('File beta');
  expect(result.titles).not.toContain('File gamma');
  expect(result.folders.map(folder => folder.name)).toEqual(expect.arrayContaining(['File folder', 'Nested folder', 'Empty child']));
  expect(result.folders.map(folder => folder.name)).not.toContain('Untouched empty');
  const parent = result.folders.find(folder => folder.name === 'File folder')!;
  expect(result.folders.find(folder => folder.name === 'Empty child')!.parentId).toBe(parent.id);
});

test('select all and clear selection cover search-hidden chats and folders', async ({ page }) => {
  const source = await fixture(page);
  await openFile(page, source);
  await page.locator('#menu').getByPlaceholder('検索').fill('File gamma');
  await page.getByRole('button', { name: 'Select all preview items', exact: true }).click();
  const commit = page.getByRole('button', { name: 'Import selected chats', exact: true });
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toContainText(/チャット\s*3\s*件/);
  await expect(commit).toBeEnabled();
  await page.getByRole('button', { name: 'Clear preview selection', exact: true }).click();
  await expect(commit).toBeDisabled();
  await page.locator('#menu').getByPlaceholder('検索').clear();
  for (const checkbox of await page.locator('#menu').getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: 'Select all preview items', exact: true }).click();
  await commit.click();
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return { titles: store.getState().chats.map(chat => chat.title), folders: Object.values(store.getState().folders) };
  });
  expect(result.titles).toHaveLength(4);
  expect(result.folders.map(folder => folder.name)).toContain('Untouched empty');
});

test('a file containing only folders can import an empty nested folder', async ({ page }) => {
  const source = await fixture(page);
  await openFile(page, { ...source, chats: [], contentStore: {} });
  const commit = page.getByRole('button', { name: 'Import selected chats', exact: true });
  await expect(commit).toBeDisabled();
  await page.locator('#menu').getByText('File folder', { exact: true }).click();
  await page.locator('#menu').getByRole('checkbox', { name: 'Select folder: Empty child', exact: true }).check();
  await expect(commit).toBeEnabled();
  await commit.click();
  await expect(page.getByRole('region', { name: 'Local file preview', exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return { titles: store.getState().chats.map(chat => chat.title), folders: Object.values(store.getState().folders) };
  });
  expect(result.titles).toEqual(['Live selected chat']);
  expect(result.folders.map(folder => folder.name)).toEqual(expect.arrayContaining(['File folder', 'Empty child']));
  expect(result.folders.map(folder => folder.name)).not.toContain('Nested folder');
  const parent = result.folders.find(folder => folder.name === 'File folder')!;
  expect(result.folders.find(folder => folder.name === 'Empty child')!.parentId).toBe(parent.id);
});

test('ordinary append groups the complete file under a new import folder', async ({ page }) => {
  const source = await fixture(page);
  await page.locator('#menu').getByText('インポート / エクスポート', { exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').first().setInputFiles({
    name: 'ordinary-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.getByRole('button', { name: 'インポート', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    return store.getState().chats.length;
  })).toBe(4);
  const result = await page.evaluate(async () => {
    const { default: store } = await import(/* @vite-ignore */ '/src/store/store.ts');
    const state = store.getState();
    return { selected: state.chats[state.currentChatIndex].id, chats: state.chats.map(chat => ({ title: chat.title, folder: chat.folder })),
      folders: Object.values(state.folders) };
  });
  const group = result.folders.find(folder => folder.name.includes('ordinary-import.json'))!;
  expect(group).toBeDefined();
  expect(result.folders.find(folder => folder.name === 'File folder')!.parentId).toBe(group.id);
  expect(result.folders.find(folder => folder.name === 'Untouched empty')!.parentId).toBe(group.id);
  expect(result.chats.find(chat => chat.title === 'File gamma')!.folder).toBe(group.id);
  expect(result.selected).toBe('source-0');
});

test('preview toolbar remains reachable above the mobile sidebar and backdrop', async ({ page }, testInfo) => {
  const source = await fixture(page);
  await openFile(page, source);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'open sidebar', exact: true }).click();
  await expect.poll(async () => (await page.locator('#menu').boundingBox())?.x).toBe(0);
  const bar = page.getByRole('region', { name: 'Local file preview', exact: true });
  const cancel = page.getByRole('button', { name: 'Cancel preview', exact: true });
  await expect(cancel).toBeInViewport();
  const barBounds = (await bar.boundingBox())!;
  const menuBounds = (await page.locator('#menu').boundingBox())!;
  expect(menuBounds.y).toBeGreaterThanOrEqual(barBounds.y + barBounds.height - 1);
  await page.screenshot({ path: testInfo.outputPath('local-file-preview-mobile.png') });
  await cancel.click();
  await expect(bar).toHaveCount(0);
});
