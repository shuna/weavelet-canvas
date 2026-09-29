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
  const changes: { fileId: string; file: any }[] = [];
  const uploads: { metadata: any; bytes: Buffer }[] = [];
  let next = 0;
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken:()=>{}}),revoke:()=>{}}}};',
  }));
  await page.route('https://oauth2.googleapis.com/**', (route) => route.fulfill({ json: { aud: 'test' } }));
  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: [`file-${++next}`] } });
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
        : metadata.appProperties?.weaveletSync === '1').map(({ metadata }) => metadata);
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
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(page.getByText('同期方向を選ぶまで自動保存は保留されています。', { exact: true })).toBeVisible();
  await expect(page.getByText('暗号化同期はロックされています。', { exact: true })).not.toBeVisible();
  await page.locator('#google-sync-passphrase').fill('browser test passphrase');
  await page.locator('#google-sync-confirm').fill('browser test passphrase');
  await page.getByRole('button', { name: '暗号化した同期フォルダーを作成', exact: true }).click();
  await expect(page.getByText('自動保存の同期先が確定しています。', { exact: true })).toBeVisible();
  expect(uploads.filter((u) => u.metadata.appProperties.kind === 'commit')).toHaveLength(1);
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  const before = uploads.length;
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'PRIVATE BROWSER TITLE';
    store.getState().setChats(chats);
  });
  await expect.poll(() => uploads.filter((u) => u.metadata.appProperties.kind === 'commit').length).toBe(2);
  expect(uploads.slice(before).reduce((total, u) => total + u.bytes.length, 0)).toBeLessThan(2000);
  for (const upload of uploads) expect(upload.bytes.toString()).not.toContain('PRIVATE BROWSER TITLE');
  await page.reload();
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(page.getByText('同期方向を選ぶまで自動保存は保留されています。', { exact: true })).toBeVisible();
  await expect(page.getByText('暗号化同期はロックされています。', { exact: true })).not.toBeVisible();
  const count = uploads.length;
  await page.locator('select').filter({ has: page.locator('option[value="resume"]') }).selectOption('resume');
  await expect(page.getByText('暗号化同期はロックされています。', { exact: true })).toBeVisible();
  await page.locator('#google-sync-passphrase').fill('wrong passphrase');
  await page.getByRole('button', { name: 'ロック解除して同期を再開', exact: true }).click();
  await expect(page.getByText('同期を完了できませんでした。ローカルデータは保存されています。', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(count);
  await page.locator('#google-sync-passphrase').fill('browser test passphrase');
  await page.getByRole('button', { name: 'ロック解除して同期を再開', exact: true }).click();
  await expect(page.getByText('自動保存の同期先が確定しています。', { exact: true })).toBeVisible();
  await expect(page.locator('#google-sync-passphrase')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('browser test passphrase');
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'unsent local edit';
    store.getState().setChats(chats);
  });
  await page.locator('select').filter({ has: page.locator('option[value="pull"]') }).selectOption('pull');
  await page.getByRole('button', { name: 'クラウド状態でローカルを上書き', exact: true }).click();
  await expect(page.getByRole('button', { name: 'close modal', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    return store.getState().chats![0].title;
  })).toBe('PRIVATE BROWSER TITLE');
  await page.screenshot({ path: testInfo.outputPath('encrypted-sync.png') });
});
