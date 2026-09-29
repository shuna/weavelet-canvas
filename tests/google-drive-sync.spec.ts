import { test, expect } from '@playwright/test';

test.use({
  headless: true,
  locale: 'ja-JP',
  screenshot: 'only-on-failure',
  actionTimeout: 10_000,
  baseURL: process.env.WEAVELET_TEST_URL ?? 'http://localhost:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE },
});

test('encrypted Drive creation, incremental autosave and unlock after browser reload', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const files = new Map<string, { metadata: any; bytes: Buffer }>();
  files.set('legacy-file', { metadata: { id: 'legacy-file', name: 'legacy.json', mimeType: 'application/json', size: '2048' }, bytes: Buffer.from('{}') });
  const changes: { fileId: string; file: any }[] = [];
  const uploads: { metadata: any; bytes: Buffer }[] = [];
  let next = 0;
  let releaseInitialCommit!: () => void;
  const initialCommitResponse = new Promise<void>(resolve => { releaseInitialCommit = resolve; });
  let holdInitialCommit = true;
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken:()=>{}}),revoke:()=>{}}}};',
  }));
  await page.route('https://oauth2.googleapis.com/**', (route) => route.fulfill({ json: { aud: 'test' } }));
  await page.route('https://{www,content}.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: Array.from({ length: Number(url.searchParams.get('count') ?? 1) }, () => `file-${++next}`) } });
    if (url.pathname.endsWith('/startPageToken')) return route.fulfill({ json: { startPageToken: String(changes.length) } });
    if (url.pathname.endsWith('/changes')) return route.fulfill({ json: {
      changes: changes.slice(Number(url.searchParams.get('pageToken'))), newStartPageToken: String(changes.length),
    } });
    if (url.pathname.startsWith('/upload/')) {
      const body = request.postDataBuffer()!;
      const boundary = request.headers()['content-type'].split('boundary=')[1];
      const metaStart = body.indexOf('\r\n\r\n') + 4;
      const metaEnd = body.indexOf(`\r\n--${boundary}`, metaStart);
      const metadata = JSON.parse(body.subarray(metaStart, metaEnd).toString());
      const dataStart = body.indexOf('\r\n\r\n', metaEnd + 2) + 4;
      const dataEnd = body.lastIndexOf(`\r\n--${boundary}--`);
      const bytes = body.subarray(dataStart, dataEnd);
      expect(files.has(metadata.id)).toBe(false);
      files.set(metadata.id, { metadata, bytes });
      uploads.push({ metadata, bytes });
      changes.push({ fileId: metadata.id, file: metadata });
      if (metadata.appProperties.kind === 'commit' && holdInitialCommit) {
        holdInitialCommit = false;
        await initialCommitResponse;
      }
      return route.fulfill({ json: { id: metadata.id } });
    }
    if (url.pathname.endsWith('/files')) {
      if (request.method() === 'POST') {
        const metadata = request.postDataJSON();
        files.set(metadata.id, { metadata, bytes: Buffer.alloc(0) });
        return route.fulfill({ json: metadata });
      }
      const commitQuery = url.searchParams.get('q')?.includes("key='kind'");
      const listed = [...files.values()].filter(({ metadata }) => commitQuery
        ? metadata.appProperties?.kind === 'commit'
        : metadata.appProperties?.weaveletSync === '1' || metadata.mimeType === 'application/json').map(({ metadata }) => metadata);
      return route.fulfill({ json: { files: listed, incompleteSearch: false } });
    }
    const file = files.get(url.pathname.split('/').at(-1)!);
    if (file) return url.searchParams.get('alt') === 'media'
      ? route.fulfill({ contentType: 'application/octet-stream', body: file.bytes })
      : route.fulfill({ json: file.metadata });
    return route.fulfill({ status: 404, json: { error: 'unexpected request' } });
  });
  await page.goto('/');
  await page.getByText('すべてスキップ', { exact: true }).click();
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    // Supply only a fake OAuth session; all Drive operations still go through the actual UI and HTTP transport.
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    auth.getState().setProvider('google');
    auth.getState().setGoogleAccessToken('test-only-token');
    auth.getState().setCloudSync(true);
  });
  files.get('legacy-file')!.bytes = Buffer.from(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { createPartializedState } = await import('/src/store/persistence.ts');
    const { STORE_VERSION } = await import('/src/store/version.ts');
    const state = structuredClone(createPartializedState(store.getState()));
    state.chats![0].title = 'legacy imported title';
    return JSON.stringify({ state, version: STORE_VERSION });
  }));
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(page.getByText('新しい同期用パスフレーズを12文字以上で入力してください。', { exact: true })).toBeVisible();
  await expect(page.getByText('暗号化同期はロックされています。', { exact: true })).not.toBeVisible();
  const operation = page.locator('select').filter({ has: page.locator('option[value="resume"]') });
  const create = page.getByRole('button', { name: '暗号化した同期フォルダーを作成', exact: true });
  const guidance = page.locator('#google-sync-guidance');
  await expect(create).toBeDisabled();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('現在のローカルデータ', { exact: true })).toBeVisible();
  await page.locator('#google-sync-passphrase').fill('short');
  await expect(guidance).toContainText('パスフレーズが12文字未満です。');
  await expect(create).toBeDisabled();
  await page.locator('#google-sync-passphrase').fill('browser test passphrase');
  await expect(guidance).toContainText('確認欄にも同じパスフレーズを入力してください。');
  await expect(create).toBeDisabled();
  await page.locator('#google-sync-confirm').fill('different passphrase');
  await expect(guidance).toContainText('パスフレーズが一致しません。');
  await expect(create).toBeDisabled();
  await page.locator('#google-sync-confirm').fill('browser test passphrase');
  await expect(guidance).toContainText('入力が揃いました。');
  await expect(create).toBeEnabled();
  // A legacy file can be selected only as input, never as an upload target.
  await operation.selectOption('pull');
  await page.getByRole('radio', { name: 'legacy.json' }).check();
  await expect(page.getByText('ファイルサイズ: 2 KB', { exact: true })).toBeVisible();
  await expect(page.locator('#google-sync-passphrase')).toHaveCount(0);
  await operation.selectOption('push');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ローカル状態でクラウドを上書き', exact: true })).toBeDisabled();
  await operation.selectOption('create');
  await expect(create).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('create-ready.png') });
  await create.click();
  const progress = page.getByTestId('google-sync-progress');
  await expect(progress).toContainText('1 / 2 ファイル完了');
  await expect(progress).toContainText(/[KM]B\/s/);
  const percent = Number(await progress.getByRole('progressbar').getAttribute('value'));
  expect(percent).toBeGreaterThan(0);
  expect(percent).toBeLessThan(100);
  await page.screenshot({ path: testInfo.outputPath('sync-progress.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(progress).toBeInViewport();
  const bounds = await progress.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('sync-progress-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await expect(page.getByRole('button', { name: '同期の進捗を表示', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'EDIT DURING INITIAL';
    store.getState().setChats(chats);
  });
  await page.getByRole('button', { name: '同期の進捗を表示', exact: true }).click();
  await expect(progress).toContainText('1 / 2 ファイル完了');
  releaseInitialCommit();
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');
  await expect(progress).toHaveCount(0);
  await expect.poll(() => uploads.filter(u => u.metadata.appProperties.kind === 'commit').length).toBe(2);
  expect(await page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().chats![0].title)).toBe('EDIT DURING INITIAL');
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const before = uploads.length;
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'PRIVATE BROWSER TITLE';
    store.getState().setChats(chats);
  });
  await expect.poll(() => uploads.filter((u) => u.metadata.appProperties.kind === 'commit').length).toBe(3);
  expect(uploads.slice(before).reduce((total, u) => total + u.bytes.length, 0)).toBeLessThan(2000);
  for (const upload of uploads) expect(upload.bytes.toString()).not.toContain('PRIVATE BROWSER TITLE');
  await page.reload();
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(page.getByText('新しい同期用パスフレーズを12文字以上で入力してください。', { exact: true })).toBeVisible();
  await expect(page.getByText('暗号化同期はロックされています。', { exact: true })).not.toBeVisible();
  const count = uploads.length;
  await page.locator('select').filter({ has: page.locator('option[value="resume"]') }).selectOption('resume');
  await expect(guidance).toContainText('既存の同期フォルダーのパスフレーズを入力してください。');
  await page.locator('#google-sync-passphrase').fill('wrong passphrase');
  await page.getByRole('button', { name: 'ロック解除して同期を再開', exact: true }).click();
  await expect(page.getByText('同期を完了できませんでした。ローカルデータは保存されています。', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(count);
  await page.locator('#google-sync-passphrase').fill('browser test passphrase');
  await page.getByRole('button', { name: 'ロック解除して同期を再開', exact: true }).click();
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');
  await expect(page.locator('#google-sync-passphrase')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('browser test passphrase');
  await operation.selectOption('pull');
  await page.getByRole('radio', { name: 'legacy.json' }).check();
  await operation.selectOption('push');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('ファイル名: legacy.json', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ローカル状態でクラウドを上書き', exact: true }).click();
  await expect(guidance).toContainText('暗号化同期フォルダーを更新します。');
  expect(uploads.some(u => u.metadata.parents.includes('legacy-file'))).toBe(false);

  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'unsent local edit';
    store.getState().setChats(chats);
  });
  await page.locator('select').filter({ has: page.locator('option[value="pull"]') }).selectOption('pull');
  await page.getByRole('radio', { name: 'Weavelet encrypted sync' }).check();
  await page.getByRole('button', { name: 'クラウド状態でローカルを上書き', exact: true }).click();
  await expect(page.getByRole('button', { name: 'close modal', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    return store.getState().chats![0].title;
  })).toBe('PRIVATE BROWSER TITLE');
  await page.getByText('Google Drive Sync', { exact: true }).click();
  await operation.selectOption('pull');
  await page.getByRole('radio', { name: 'legacy.json' }).check();
  const beforeLegacyRead = uploads.length;
  await expect(page.locator('#google-sync-passphrase')).toHaveCount(0);
  await page.getByRole('button', { name: 'クラウド状態でローカルを上書き', exact: true }).click();
  await expect(page.getByRole('button', { name: 'close modal', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    return { title: store.getState().chats![0].title, confirmed: auth.getState().syncTargetConfirmed };
  })).toEqual({ title: 'legacy imported title', confirmed: false });
  expect(uploads).toHaveLength(beforeLegacyRead);
  await page.screenshot({ path: testInfo.outputPath('encrypted-sync.png') });
});


test('large sync compression runs in a worker while the UI event loop remains responsive', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { encodeAsync } = await import('/src/store/storage/google/encodeAsync.ts');
    const { decode } = await import('/src/store/storage/google/crypto.ts');
    const value = { text: 'synthetic responsive sync '.repeat(200_000) };
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    try {
      const bytes = await encodeAsync(value);
      return { ticks, matches: decode<{ text: string }>(bytes).text === value.text };
    } finally { clearInterval(timer); }
  });
  expect(result.matches).toBe(true);
  expect(result.ticks).toBeGreaterThan(0);
});
