import { test, expect } from '@playwright/test';

test.use({ headless: true, actionTimeout: 10_000, locale: 'ja-JP', baseURL: process.env.WEAVELET_TEST_URL ?? 'http://localhost:5175', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('sync details keep conflict targets scrollable without moving choices', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.route('https://accounts.google.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken:()=>{}}),revoke:()=>{}}}};',
  }));
  await page.goto('/');
  await page.getByText('すべてスキップ', { exact: true }).click();
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().chats?.length ?? 0)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    auth.setState({ provider: 'google', cloudSync: true, syncStatus: 'synced' });
  });
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(page.getByRole('heading', { name: /データ同期の詳細/ })).toBeVisible();
  await expect(page.getByText('プライバシーは非常に重要です。', { exact: false })).toHaveCount(0);
  await expect(page.getByText('会話と設定を Google Drive とスムーズに同期します。')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /データ同期の詳細/ }).getByText('暗号化について')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /データ同期の詳細/ }).getByText('同期先：Google Drive')).toBeVisible();
  await expect(page.getByText('暗号化について', { exact: true })).toBeVisible();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByText('暗号化について', { exact: true }).getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('パスフレーズ');
  await page.getByText('データ同期の詳細', { exact: true }).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { useSyncReview } = await import('/src/store/storage/google/conflicts.ts');
    const chat = store.getState().chats![0];
    store.getState().setChats([{ ...chat, title: '競合している会話' }]);
    store.getState().setFolders({ 'conflict-folder': { id: 'conflict-folder', name: '競合しているフォルダー', expanded: true, order: 0 } });
    useSyncReview.setState({ cloudOverview: { chats: 120, messages: 2400, bytes: 10485760, versions: 2 }, conflict: true, conflictKeys: [JSON.stringify(['chats', chat.id, 'title']), JSON.stringify(['state', 'folders', 'conflict-folder', 'name'])] });
  });
  await expect(page.getByText('同期する内容が競合しています', { exact: true })).toBeVisible();
  await expect(page.getByText('内容を確認し、解決方法を選んでください。', { exact: true })).toBeVisible();
  await expect(page.getByText('クラウドの2版を統合した概要', { exact: true })).toHaveCount(0);
  const mergePanel = page.getByRole('radio', { name: 'マージ（両方を保持）', exact: true }).locator('..').locator('..');
  // A dark theme must not fall back to the light card background.
  expect(await mergePanel.evaluate(element => getComputedStyle(element).backgroundColor)).not.toContain('209, 250, 229');
  await expect(page.getByRole('combobox', { name: '実行する操作' })).toHaveCount(0);
  const apply = page.getByRole('button', { name: '選択した方法で同期', exact: true });
  await expect(apply).toBeDisabled();
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await mergePanel.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('同じメッセージの競合');
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(apply).toBeDisabled();
  await page.getByText('データ同期の詳細', { exact: true }).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  for (const name of ['クラウドの内容でこの端末を上書き', 'この端末の内容でクラウドを上書き', 'マージ（両方を保持）']) {
    // The full card is selectable; switching the choice must not start sync.
    await page.getByRole('radio', { name, exact: true }).locator('..').locator('..').click();
    await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
    expect(await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().syncStatus)).toBe('synced');
  }
  await expect(apply).toBeEnabled();
  const overview = page.getByRole('table', { name: '概要', exact: true });
  await expect(overview.getByRole('row', { name: /会話数/ })).toContainText('120');
  await expect(overview.getByRole('row', { name: /メッセージ数/ })).toContainText('2,400');
  await expect(overview.getByRole('row', { name: /同期データ量/ })).toContainText('10 MB');
  await expect(page.getByText('最終変更日時', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: /競合の対象/ }).click();
  const targetList = page.getByRole('region', { name: /競合の対象/ });
  await expect(targetList.getByText('競合している会話', { exact: true })).toBeVisible();
  await expect(targetList.getByText('競合しているフォルダー', { exact: true })).toBeVisible();
  await expect(page.locator('summary')).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['マージ（両方を保持）', 'この端末の内容でクラウドを上書き', 'クラウドの内容でこの端末を上書き']) {
      const button = page.getByRole('radio', { name, exact: true }).locator('..').locator('..');
      await expect(button).toBeInViewport();
      await expect(button).toBeEnabled();
      const bounds = await button.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    const applyBounds = await apply.boundingBox();
    expect(applyBounds!.x + applyBounds!.width).toBeLessThanOrEqual(width);
    const modal = page.getByRole('heading', { name: /データ同期の詳細/ }).locator('..').locator('..');
    const targetWidth = (await modal.boundingBox())!.width;
    const targetChoicesWidth = (await page.locator('fieldset').boundingBox())!.width;
    const targetTabsWidth = (await page.getByRole('tablist').boundingBox())!.width;
    await page.getByRole('tab', { name: '概要', exact: true }).click();
    expect((await modal.boundingBox())!.width).toBe(targetWidth);
    expect((await page.locator('fieldset').boundingBox())!.width).toBe(targetChoicesWidth);
    expect((await page.getByRole('tablist').boundingBox())!.width).toBe(targetTabsWidth);
    await page.getByRole('tab', { name: /競合の対象/ }).click();
    expect((await modal.boundingBox())!.width).toBe(targetWidth);
    const initialHeight = (await modal.boundingBox())!.height;
    const choices = page.locator('fieldset');
    const initialChoiceBounds = await choices.boundingBox();
    const initialListHeight = (await targetList.boundingBox())!.height;
    await page.evaluate(async () => {
      const { useSyncReview } = await import('/src/store/storage/google/conflicts.ts');
      useSyncReview.setState({ conflictKeys: Array.from({ length: 80 }, (_, index) => JSON.stringify(['state', `setting-${index}`])) });
    });
    await expect(page.getByRole('tab', { name: '競合の対象（80件）', exact: true })).toBeVisible();
    expect(Math.abs((await modal.boundingBox())!.height - initialHeight)).toBeLessThanOrEqual(1);
    expect(await targetList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(page.getByTestId('google-sync-targets-more')).toBeVisible();
    expect(await targetList.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
    await targetList.press('End');
    await expect.poll(() => targetList.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByTestId('google-sync-targets-more')).toBeHidden();
    expect(await choices.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
    const lastChoice = page.getByRole('radio', { name: 'クラウドの内容でこの端末を上書き', exact: true }).locator('..').locator('..');
    await expect(lastChoice).toBeInViewport();
    const bodyBounds = await modal.locator('> .overflow-hidden').boundingBox();
    const lastChoiceBounds = await lastChoice.boundingBox();
    expect(lastChoiceBounds!.y + lastChoiceBounds!.height).toBeLessThanOrEqual(bodyBounds!.y + bodyBounds!.height + 1);
    expect(lastChoiceBounds!.y + lastChoiceBounds!.height).toBeLessThanOrEqual((await apply.boundingBox())!.y);
    expect(Math.abs((await choices.boundingBox())!.y - initialChoiceBounds!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await apply.boundingBox())!.y - applyBounds!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await targetList.boundingBox())!.height - initialListHeight)).toBeLessThanOrEqual(1);
    expect(await modal.locator('> .overflow-hidden').evaluate(element => element.scrollTop)).toBe(0);
    expect(await modal.locator('> .overflow-hidden').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(Math.abs((await modal.boundingBox())!.height - initialHeight)).toBeLessThanOrEqual(1);
    await page.evaluate(async () => {
      const { default: store } = await import('/src/store/store.ts');
      const { useSyncReview } = await import('/src/store/storage/google/conflicts.ts');
      useSyncReview.setState({ conflictKeys: [JSON.stringify(['chats', store.getState().chats![0].id, 'title']), JSON.stringify(['state', 'folders', 'conflict-folder', 'name'])] });
    });
    await expect(page.getByTestId('google-sync-targets-more')).toBeHidden();
    await page.getByRole('tab', { name: '概要', exact: true }).click();
    await expect(overview).toBeVisible();
    expect(Math.abs((await choices.boundingBox())!.y - initialChoiceBounds!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await apply.boundingBox())!.y - applyBounds!.y)).toBeLessThanOrEqual(1);
    await page.getByRole('tab', { name: /競合の対象/ }).click();
    await page.screenshot({ path: testInfo.outputPath(`conflict-${width}.png`) });
  }
  await page.evaluate(async () => {
    const { useSyncReview } = await import('/src/store/storage/google/conflicts.ts');
    useSyncReview.setState({ conflictKeys: [] });
  });
  await expect(page.getByText('競合対象の詳細を取得できませんでした。両方のデータは保持されています。')).toBeVisible();
  await expect(apply).toBeDisabled();
  await page.getByRole('radio', { name: 'この端末の内容でクラウドを上書き', exact: true }).check();
  await apply.click();
  // No Drive session was opened: this failure proves execution starts only on apply.
  await expect(page.getByText('Unlock Google sync first.', { exact: true })).toBeVisible();
});

test('reads conflict context on either side without editing or synchronizing', async ({ page }, testInfo) => {
  await page.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken:()=>{}}),revoke:()=>{}}}};' }));
  await page.goto('/');
  await page.getByText('すべてスキップ', { exact: true }).click();
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().chats?.length ?? 0)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    const { useSyncReview } = await import('/src/store/storage/google/conflicts.ts');
    const { addContent } = await import('/src/utils/contentStore.ts');
    const base = store.getState().chats![0];
    const makeSnapshot = (side: string) => {
      const contentStore = {};
      const node = (id: string, parentId: string | null, text: string) => ({ id, parentId, role: 'user' as const, createdAt: 1, contentHash: addContent(contentStore, [{ type: 'text', text }]) });
      return { version: 18, state: { contentStore, chats: [{ ...base, id: 'detail-chat', title: '詳細検証会話', messages: [], branchTree: {
        rootId: 'before', activePath: ['before', 'target', 'left'], nodes: {
          before: node('before', null, '前の発言'), target: node('target', 'before', side + 'の本文'),
          left: node('left', 'target', side + 'の後の発言 A'), right: node('right', 'target', side + 'の後の発言 B'),
        },
      } }] } };
    };
    const local = makeSnapshot('端末'), cloud = makeSnapshot('クラウド');
    const absentBubble = structuredClone(cloud);
    delete absentBubble.state.chats[0].branchTree.nodes.target;
    absentBubble.state.chats[0].branchTree.nodes.left.parentId = 'before';
    absentBubble.state.chats[0].branchTree.nodes.right.parentId = 'before';
    absentBubble.state.chats[0].branchTree.activePath = ['before', 'left'];
    store.setState(local.state);
    auth.setState({ provider: 'google', cloudSync: true, syncStatus: 'synced' });
    useSyncReview.setState({ conflict: true,
      cloudOverview: { chats: 1, messages: 4, bytes: 1000, versions: 3 },
      cloudReview: { snapshot: cloud, versions: [{ id: 'one', snapshot: cloud }, { id: 'two', snapshot: absentBubble }, { id: 'three', snapshot: { version: 18, state: { chats: [], contentStore: {} } } }] },
      conflictKeys: [...Array.from({ length: 30 }, (_, index) => JSON.stringify(['state', 'setting-' + index])), JSON.stringify(['chats', 'detail-chat', 'branchTree', 'nodes', 'target', 'contentHash'])],
    });
  });
  const original = await page.evaluate(async () => {
    const store = (await import('/src/store/store.ts')).default;
    return JSON.stringify({ chats: store.getState().chats, contentStore: store.getState().contentStore });
  });
  await page.getByRole('radio', { name: 'マージ（両方を保持）', exact: true }).check();
  await page.getByRole('tab', { name: /競合の対象/ }).click();
  const targets = page.getByRole('region', { name: /競合の対象/ });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await targets.press('End');
    await expect.poll(() => targets.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
    const scrollBefore = await targets.evaluate(element => element.scrollTop);
    const applyBefore = await page.getByRole('button', { name: '選択した方法で同期', exact: true }).boundingBox();
    await targets.getByRole('button', { name: /詳細検証会話/ }).click();
    const contents = page.getByRole('region', { name: '会話・競合項目の内容', exact: true });
    await expect(contents.getByText('端末の本文', { exact: true })).toBeVisible();
    await expect(contents.getByText('前の発言', { exact: true })).toBeVisible();
    await expect(contents.getByText('端末の後の発言 A', { exact: true })).toBeVisible();
    await expect(page.getByText('このブランチの2番目のバブルが競合しています。')).toBeVisible();
    await expect(page.getByRole('button', { name: '選択した方法で同期', exact: true })).toBeHidden();
    await expect(contents.locator('textarea, input, [contenteditable="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'クラウド', exact: true }).click();
    await expect(contents.getByText('クラウドの本文', { exact: true })).toBeVisible();
    await page.getByLabel('ブランチ', { exact: true }).selectOption('right');
    await expect(contents.getByText('クラウドの後の発言 B', { exact: true })).toBeVisible();
    await page.getByLabel('クラウドの版', { exact: true }).selectOption('two');
    await expect(page.getByText('この側には該当バブルがありません。残っているブランチの内容を表示します。')).toBeVisible();
    await expect(contents.getByText('該当バブル', { exact: true })).toHaveCount(0);
    await page.getByLabel('クラウドの版', { exact: true }).selectOption('three');
    await expect(contents.getByText('この側には該当する会話がありません。')).toBeVisible();
    await page.getByRole('button', { name: 'この端末', exact: true }).click();
    await expect(contents.getByText('端末の本文', { exact: true })).toBeVisible();
    const back = page.getByRole('button', { name: '競合一覧に戻る', exact: true });
    await expect(back).toBeInViewport();
    await expect(page.getByRole('heading', { name: '競合の詳細', exact: true })).toHaveCount(1);
    await expect(page.getByText('暗号化について', { exact: true })).toBeHidden();
    await expect(page.getByRole('heading', { name: '競合の詳細', exact: true }).getByText('Google Drive')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'close modal', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(contents).toBeVisible();
    expect((await back.boundingBox())!.y).toBeLessThan((await contents.boundingBox())!.y);
    const bounds = await contents.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`conflict-details-${width}.png`) });
    await back.click();
    await expect(page.getByRole('button', { name: 'close modal', exact: true })).toBeEnabled();
    await expect(page.getByRole('radio', { name: 'マージ（両方を保持）', exact: true })).toBeChecked();
    expect(await targets.evaluate(element => element.scrollTop)).toBe(scrollBefore);
    expect(Math.abs((await page.getByRole('button', { name: '選択した方法で同期', exact: true }).boundingBox())!.y - applyBefore!.y)).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(async () => {
    const store = (await import('/src/store/store.ts')).default;
    return JSON.stringify({ chats: store.getState().chats, contentStore: store.getState().contentStore });
  })).toBe(original);
  expect(await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().syncStatus)).toBe('synced');
  expect(await page.evaluate(() => localStorage.getItem('weavelet-sync-review'))).not.toContain('クラウドの本文');
});
