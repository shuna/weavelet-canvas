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
  let heldCommitResponse = initialCommitResponse;
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
        await heldCommitResponse;
      }
      return route.fulfill({ json: { id: metadata.id } });
    }
    if (url.pathname.endsWith('/files')) {
      if (request.method() === 'POST') {
        const metadata = request.postDataJSON();
        files.set(metadata.id, { metadata, bytes: Buffer.alloc(0) });
        return route.fulfill({ json: metadata });
      }
      if (url.searchParams.get('fields')?.includes('files(id,size)')) {
        const folderId = url.searchParams.get('q')!.match(/^'([^']+)' in parents/)![1];
        const children = [...files.values()].filter(({ metadata }) => metadata.parents?.includes(folderId));
        return route.fulfill({ json: { files: children.map(({ metadata, bytes }) => ({ id: metadata.id, size: String(bytes.length) })) } });
      }
      const kind = url.searchParams.get('q')?.match(/key='kind' and value='([^']+)'/)?.[1];
      const listed = [...files.values()].filter(({ metadata }) => kind
        ? metadata.appProperties?.kind === kind
        : metadata.appProperties?.weaveletSync === '1' || metadata.mimeType === 'application/json').map(({ metadata }) => metadata);
      return route.fulfill({ json: { files: listed, incompleteSearch: false } });
    }
    const file = files.get(url.pathname.split('/').at(-1)!);
    if (file && request.method() === 'PATCH') {
      Object.assign(file.metadata, request.postDataJSON());
      return route.fulfill({ json: file.metadata });
    }
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
  const operation = page.getByRole('combobox', { name: '実行する操作', exact: true });
  const create = page.getByRole('button', { name: '暗号化した同期フォルダーを作成', exact: true });
  const guidance = page.locator('#google-sync-guidance');
  await expect(create).toBeDisabled();
  await expect(page.locator('#google-sync-folder-name')).toHaveValue('Weavelet encrypted sync');
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
  await expect(operation.locator('option[value="push"]')).toHaveCount(0);
  await operation.selectOption('create');
  await expect(create).toBeEnabled();
  await page.locator('#google-sync-folder-name').fill('');
  await expect(create).toBeDisabled();
  await expect(guidance).toContainText('同期フォルダーの名前を入力してください。');
  await page.locator('#google-sync-folder-name').fill('Project sync');
  // Simulate folders appearing after the initial listing; creation rechecks names.
  for (const [index, name] of ['Project sync', 'Project sync (2)'].entries()) {
    files.set(`existing-${index}`, { metadata: { id: `existing-${index}`, name, mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId: 'unused' } }, bytes: Buffer.alloc(0) });
  }
  await page.screenshot({ path: testInfo.outputPath('create-ready.png') });
  await create.click();
  const progress = page.getByTestId('google-sync-progress');
  await expect(progress).toContainText('1 / 2 ファイル完了');
  await expect(progress).toContainText(/[KM]B\/s/);
  await expect(progress.getByRole('progressbar')).toHaveCount(2);
  await expect(progress.getByRole('progressbar').first()).toHaveAttribute('aria-label', '全体');
  const percent = Number(await progress.getByRole('progressbar').nth(1).getAttribute('value'));
  const overall = Number(await progress.getByRole('progressbar', { name: '全体', exact: true }).getAttribute('value'));
  expect(overall).toBeGreaterThan(0);
  expect(overall).toBeLessThan(100);
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
  await expect(operation.locator('option:checked')).toHaveText('自動同期（有効）');
  await expect(page.getByRole('button', { name: 'ロック解除して同期を再開', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '自動同期（有効）', exact: true })).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await expect.poll(() => uploads.filter(u => u.metadata.appProperties.kind === 'commit').length).toBe(2);
  expect(await page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().chats![0].title)).toBe('EDIT DURING INITIAL');
  const total = uploads.reduce((sum, upload) => sum + upload.bytes.length, 0);
  const units = ['B', 'KB', 'MB'];
  const unit = total < 1024 ? 0 : total < 1024 * 1024 ? 1 : 2;
  const value = total / 1024 ** unit;
  const formatted = new Intl.NumberFormat('ja', { maximumFractionDigits: value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2 }).format(value);
  await expect(page.getByText(`フォルダー内の合計サイズ: ${formatted} ${units[unit]}`, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  const before = uploads.length;
  let releaseRenameCommit!: () => void;
  heldCommitResponse = new Promise<void>(resolve => { releaseRenameCommit = resolve; });
  holdInitialCommit = true;
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'PRIVATE BROWSER TITLE';
    store.getState().setChats(chats);
  });
  await expect.poll(() => uploads.filter((u) => u.metadata.appProperties.kind === 'commit').length).toBe(3);
  const syncBanner = page.locator('[data-google-sync-banner]');
  await expect(syncBanner).toBeVisible();
  await expect(syncBanner.locator('progress')).toHaveCount(2);
  await expect(syncBanner.locator('progress').first()).toBeVisible();
  await expect(syncBanner.locator('progress').first()).toHaveAttribute('aria-label', '全体');
  expect(await syncBanner.locator('progress').nth(1).evaluate((element: HTMLProgressElement) => [element.value, element.max]))
    .toEqual(await page.evaluate(async () => {
      const progress = (await import('/src/store/storage/google/progress.ts')).useGoogleSyncProgress.getState();
      return [progress.completedFiles / progress.totalFiles!, 1];
    }));
  const overallBar = syncBanner.getByRole('progressbar', { name: '全体', exact: true });
  await expect(overallBar).toBeVisible();
  expect(await overallBar.evaluate((element: HTMLProgressElement) => element.value)).toBeLessThan(1);
  expect(await syncBanner.locator('progress').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))).toEqual([2, 2]);
  const viewBarBottom = await page.locator('#google-sync-banner-overlay').evaluate(element => element.parentElement!.getBoundingClientRect().bottom);
  expect(await syncBanner.evaluate((element) => element.getBoundingClientRect().top)).toBe(viewBarBottom);
  expect(await syncBanner.evaluate((element) => element.getBoundingClientRect().height)).toBe(24);
  expect(await page.locator('#root').evaluate((element) => getComputedStyle(element).paddingTop)).toBe('0px');
  await page.getByRole('button', { name: '同期の進捗を表示', exact: true }).click();
  const targetId = await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().fileId);
  const nameInput = page.locator(`[id="sync-folder-name-${targetId}"]`);
  await expect(nameInput).toHaveValue('Project sync (3)');
  await nameInput.fill('Renamed during sync');
  await page.getByRole('button', { name: '名前を変更', exact: true }).click();
  await expect.poll(() => files.get(targetId!)!.metadata.name).toBe('Renamed during sync');
  expect(await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().syncStatus)).toBe('syncing');
  releaseRenameCommit();
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');
  files.get(targetId!)!.metadata.name = 'Renamed on Drive';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(nameInput).toHaveValue('Renamed on Drive');
  await operation.selectOption('create');
  await expect(page.locator('#google-sync-folder-name')).toHaveValue('Weavelet encrypted sync');
  await page.locator('#google-sync-folder-name').fill('Project sync');
  await expect(page.getByText('作成する名前: Project sync (3)', { exact: true })).toBeVisible();
  await operation.selectOption('resume');

  expect(uploads.slice(before).reduce((total, u) => total + u.bytes.length, 0)).toBeLessThan(2000);
  for (const upload of uploads) expect(upload.bytes.toString()).not.toContain('PRIVATE BROWSER TITLE');
  const savedTarget = await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().fileId);
  await page.reload();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().syncStatus)).toBe('synced');
  expect(await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().fileId)).toBe(savedTarget);
  await expect(page.getByRole('button', { name: 'close modal', exact: true })).toHaveCount(0);
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');
  await expect(operation.locator('option:checked')).toHaveText('自動同期（有効）');
  await expect(page.locator('#google-sync-passphrase')).toHaveCount(0);
  await expect(operation.locator('option[value="pull"], option[value="push"]')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('browser test passphrase');
  await page.evaluate(async () => {
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    auth.getState().setSyncStatus('error');
  });
  await expect(operation.locator('option:checked')).toHaveText('同期を再試行');
  await expect(page.locator('#google-sync-passphrase')).toHaveCount(0);
  await page.getByRole('button', { name: '同期を再試行', exact: true }).click();
  await expect(operation.locator('option:checked')).toHaveText('自動同期（有効）');
  await expect(page.getByRole('button', { name: '同期を再試行', exact: true })).toHaveCount(0);

  // Simulate an independently published encrypted remote edit without advancing this device's cache.
  const folderCommitCount = uploads.filter(u => u.metadata.appProperties.kind === 'commit').length;
  await page.evaluate(async () => {
    const store = (await import('/src/store/store.ts')).default;
    store.getState().setFolders({ folder: { id: 'folder', name: 'Shared folder', expanded: true, order: 0 } });
    const chats = structuredClone(store.getState().chats!); chats[0].folder = 'folder'; store.getState().setChats(chats);
  });
  await expect.poll(() => uploads.filter(u => u.metadata.appProperties.kind === 'commit').length).toBe(folderCommitCount + 1);
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');
  const parent = uploads.filter(u => u.metadata.appProperties.kind === 'commit').at(-1)!.metadata.id;
  await page.evaluate(async parent => {
    const store = (await import('/src/store/store.ts')).default;
    const auth = (await import('/src/store/cloud-auth-store.ts')).default.getState();
    const { createPartializedState } = await import('/src/store/persistence.ts');
    const { STORE_VERSION } = await import('/src/store/version.ts');
    const { toRecords, diffRecords } = await import('/src/store/storage/google/records.ts');
    const { encrypt, encode } = await import('/src/store/storage/google/crypto.ts');
    const { rememberedSyncKey } = await import('/src/store/storage/google/cache.ts');
    const { DriveTransport } = await import('/src/store/storage/google/transport.ts');
    const original = { state: structuredClone(createPartializedState(store.getState())), version: STORE_VERSION };
    const remote = structuredClone(original);
    remote.state.chats![0].title = 'REMOTE CONFLICT'; remote.state.folders!.folder.name = 'Remote folder';
    const drive = new DriveTransport(() => auth.googleAccessToken!);
    const [id] = await drive.ids(1);
    const changes = await diffRecords(await toRecords(original), await toRecords(remote));
    await drive.put(id, auth.fileId!, 'commit', await encrypt((await rememberedSyncKey(auth.fileId!))!,
      encode({ version: 2, parents: [parent], changes }), `${auth.fileId}:${id}`));
    const chats = structuredClone(store.getState().chats!); chats[0].title = 'LOCAL CONFLICT'; store.getState().setChats(chats);
    store.getState().setFolders({ folder: { id: 'folder', name: 'Local folder', expanded: true, order: 0 } });
  }, parent);
  await expect(page.getByRole('button', { name: 'マージ（両方を保持）', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この端末の内容を優先', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'クラウドの内容を優先', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'マージ（両方を保持）', exact: true }).click();
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');
  const merged = await page.evaluate(async () => {
    const state = (await import('/src/store/store.ts')).default.getState();
    return { titles: state.chats!.map(c => c.title).sort(), folders: Object.values(state.folders).map(f => f.name).sort() };
  });
  expect(merged).toEqual({ titles: ['LOCAL CONFLICT', 'REMOTE CONFLICT'], folders: ['Local folder', 'Remote folder'] });
  await expect(page.locator('a[data-sync-changed="true"]')).toHaveCount(2);
  await expect(page.locator('div[data-sync-changed="true"]')).toHaveCount(2);
  const beforeUnsentTitle = await page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().chats![0].title);

  const remoteParent = uploads.filter(u => u.metadata.appProperties.kind === 'commit').at(-1)!.metadata.id;
  const remoteTheme = await page.evaluate(async parent => {
    const auth = (await import('/src/store/cloud-auth-store.ts')).default.getState();
    const theme = (await import('/src/store/store.ts')).default.getState().theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    const { DriveTransport } = await import('/src/store/storage/google/transport.ts');
    const { rememberedSyncKey } = await import('/src/store/storage/google/cache.ts');
    const { digest, encode, encrypt } = await import('/src/store/storage/google/crypto.ts');
    const drive = new DriveTransport(() => auth.googleAccessToken!);
    const [id] = await drive.ids(1);
    await drive.put(id, auth.fileId!, 'commit', await encrypt((await rememberedSyncKey(auth.fileId!))!,
      encode({ version: 2, parents: [parent], changes: [{ key: '["state","theme"]', before: await digest(JSON.stringify(theme)), after: JSON.stringify(next) }] }), `${auth.fileId}:${id}`));
    return next;
  }, remoteParent);
  await page.reload();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().theme)).toBe(remoteTheme);
  await expect(page.getByRole('button', { name: 'close modal', exact: true })).toHaveCount(0);
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(guidance).toContainText('変更は暗号化して自動保存されます。');

  // A fresh/unconfirmed target retains the explicit import path for legacy data and existing folders.
  await page.evaluate(async () => {
    const { pauseGoogleSync } = await import('/src/store/storage/GoogleCloudStorage.ts');
    await pauseGoogleSync();
    (await import('/src/store/cloud-auth-store.ts')).default.getState().setSyncTargetConfirmed(false);
  });
  await page.reload();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().syncStatus)).toBe('locked');
  await page.getByText('クラウド同期', { exact: false }).click();
  await expect(operation).toHaveValue('pull');
  await expect(operation.locator('option:checked')).toHaveText('既存の同期フォルダー・旧形式ファイルを選択');
  await expect(operation.locator('option[value="resume"]')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Renamed on Drive', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Project sync (2)', exact: true })).toBeVisible();
  await page.locator('#google-sync-passphrase').fill('browser test passphrase');
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'unsent local edit';
    store.getState().setChats(chats);
  });
  await page.locator('select').filter({ has: page.locator('option[value="pull"]') }).selectOption('pull');
  await page.getByRole('radio', { name: 'Renamed on Drive', exact: true }).check();
  await page.getByRole('button', { name: 'クラウド状態でローカルを上書き', exact: true }).click();
  await expect(page.getByRole('button', { name: 'close modal', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    return store.getState().chats![0].title;
  })).toBe(beforeUnsentTitle);
  await page.evaluate(async () => (await import('/src/store/cloud-auth-store.ts')).default.getState().setSyncTargetConfirmed(false));
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


test('large sync processing preserves data while keeping the UI event loop responsive', async ({ page }, testInfo) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const processing = await import('/src/store/storage/google/processing.ts');
    const { toRecords, fromRecords, sameSnapshot } = await import('/src/store/storage/google/records.ts');
    const { decode } = await import('/src/store/storage/google/crypto.ts');
    const { prepareSave } = await import('/src/store/storage/prepareSave.ts');
    const { prepareHydratedData } = await import('/src/store/rehydrateData.ts');
    const { replayHistory } = await import('/src/store/storage/google/replay.ts');
    const { decodeParts } = await import('/src/store/storage/google/decodeParts.ts');
    const { SyncConflictError } = await import('/src/store/storage/google/records.ts');
    // Identical to the pre-fix 60 MiB probe; no personal data or Drive traffic.
    const snapshot = { version: 1, state: { chats: Array.from({ length: 30 }, (_, i) => ({
      id: `bench-${i}`, title: `synthetic ${i}`, messages: [{ role: 'user', content: [
        { type: 'text', text: '0123456789abcdefghijklmnopqrstuv'.repeat(65536) },
      ] }],
    })), contentStore: {} } };
    const inputBytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    async function measure<T>(work: () => T | Promise<T>) {
      let maxGap = 0, last = performance.now(), ticks = 0;
      const timer = setInterval(() => {
        const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++;
      }, 10);
      try {
        await new Promise(resolve => setTimeout(resolve, 30));
        const start = performance.now();
        const value = await work();
        const ms = performance.now() - start;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { value, stats: { ms: Math.round(ms), maxEventLoopGapMs: Math.round(maxGap), ticks } };
      } finally { clearInterval(timer); }
    }
    const before = await measure(() => toRecords(snapshot));
    const after = await measure(() => processing.toRecordsAsync(snapshot));
    const encoded = await measure(() => processing.encodeAsync({ version: 1, parents: [],
      changes: Object.entries(after.value).map(([key, value]) => ({ key, before: null, after: value })),
    }));
    const decodeBefore = await measure(() => decode(encoded.value));
    const decodeAfter = await measure(() => processing.decodeAsync(encoded.value));
    const restoreBefore = await measure(() => fromRecords(before.value));
    const restoreAfter = await measure(() => processing.fromRecordsAsync(after.value));
    const compareBefore = await measure(() => sameSnapshot([snapshot, snapshot]));
    const compareAfter = await measure(() => processing.sameSnapshotAsync(snapshot, snapshot));
    // Short tasks are sensitive to GC and timer rounding; compare median gaps over three runs.
    async function medianMeasure<T>(work: () => T | Promise<T>) {
      const runs = [await measure(work), await measure(work), await measure(work)];
      return runs.sort((a, b) => a.stats.maxEventLoopGapMs - b.stats.maxEventLoopGapMs)[1];
    }
    const saveBefore = await medianMeasure(() => prepareSave(snapshot.state));
    const saveAfter = await medianMeasure(() => processing.prepareSaveAsync(snapshot.state));
    const { saveChatData } = await import('/src/store/storage/IndexedDbStorage.ts');
    const localSave = await measure(() => saveChatData(snapshot.state));
    // Many nodes, rather than only a few very large text fields.
    const hydration = { savedIndex: 0, base: {}, persisted: {
      contentStore: { content: { content: [{ type: 'text', text: 'synthetic node' }], refCount: 30000 } },
      chats: Array.from({ length: 3000 }, (_, i) => ({ id: `tree-${i}`, title: 'synthetic', config: { systemPrompt: '' },
        branchTree: { rootId: 'n0', activePath: Array.from({ length: 10 }, (_, n) => `n${n}`),
          nodes: Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`n${n}`, {
            id: `n${n}`, parentId: n ? `n${n - 1}` : null, role: 'user', contentHash: 'content', createdAt: 0,
          }])) },
      })),
    } };
    const hydrateBefore = await measure(() => prepareHydratedData(structuredClone(hydration)));
    const hydrateAfter = await measure(() => processing.prepareHydratedDataAsync(hydration));
    const history = { tips: ['initial'], commits: { initial: { version: 1, parents: [],
      changes: Array.from({ length: 30000 }, (_, i) => ({ key: JSON.stringify(['chats', `c${i}`, 'title']), before: null, after: '"synthetic"' })),
    } } };
    const replayBefore = await measure(() => replayHistory(history));
    const replayAfter = await measure(() => processing.replayHistoryAsync(history));
    const parts = [encoded.value.slice(0, 10000), encoded.value.slice(10000)];
    const partsBefore = await measure(() => decodeParts(parts));
    const partsAfter = await measure(() => processing.decodePartsAsync(parts));
    const conflictTyped = await processing.replayHistoryAsync({ tips: ['bad'], commits: { bad: {
      version: 1, parents: [], changes: [{ key: 'key', before: 'missing', after: '"value"' }],
    } } }).then(() => false, error => error instanceof SyncConflictError && error.keys[0] === 'key');
    const source = { chats: [{ id: 'captured', title: 'before' }], contentStore: {} };
    const capture = processing.prepareSaveAsync(source);
    source.chats[0].title = 'edited during preparation';
    const captured = await capture;
    const captureMatches = captured.data.chats[0].title === 'before' && captured.fingerprints[0][1] === JSON.stringify(captured.data.chats[0]);
    const edited = structuredClone(snapshot); edited.state.chats[0].title = 'edited';
    const detectsEdit = !await processing.sameSnapshotAsync(snapshot, edited);
    const rejectsInvalid = await processing.decodeAsync(new Uint8Array([0])).then(() => false, () => true);
    const rejectsUnsafe = await processing.fromRecordsAsync({ '["__proto__"]': '{}' }).then(() => false, () => true);
    return {
      inputBytes, compressedBytes: encoded.value.length,
      before: { records: before.stats, decode: decodeBefore.stats, restore: restoreBefore.stats, compare: compareBefore.stats },
      after: { records: after.stats, encode: encoded.stats, decode: decodeAfter.stats, restore: restoreAfter.stats, compare: compareAfter.stats },
      matches: JSON.stringify(before.value) === JSON.stringify(after.value) &&
        JSON.stringify(decodeBefore.value) === JSON.stringify(decodeAfter.value) &&
        JSON.stringify(restoreBefore.value) === JSON.stringify(restoreAfter.value) && compareAfter.value,
      detectsEdit, rejectsInvalid, rejectsUnsafe, conflictTyped, captureMatches,
      remainingBefore: { savePreparation: saveBefore.stats, hydration: hydrateBefore.stats, replay: replayBefore.stats, parts: partsBefore.stats },
      remainingAfter: { savePreparation: saveAfter.stats, hydration: hydrateAfter.stats, replay: replayAfter.stats, parts: partsAfter.stats, localSave: localSave.stats },
      remainingMatches: JSON.stringify(saveBefore.value) === JSON.stringify(saveAfter.value) &&
        JSON.stringify(hydrateBefore.value) === JSON.stringify(hydrateAfter.value) &&
        JSON.stringify(replayBefore.value) === JSON.stringify(replayAfter.value) &&
        JSON.stringify(partsBefore.value.value) === JSON.stringify(partsAfter.value.value),
    };
  });
  await testInfo.attach('sync-worker-measurements', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.info('SYNC_WORKER_BENCH', JSON.stringify(result));
  expect(result.matches).toBe(true);
  expect(result.detectsEdit).toBe(true);
  expect(result.rejectsInvalid).toBe(true);
  expect(result.rejectsUnsafe).toBe(true);
  expect(result.remainingMatches).toBe(true);
  expect(result.conflictTyped).toBe(true);
  expect(result.captureMatches).toBe(true);
  for (const stage of ['savePreparation', 'replay', 'parts'] as const) {
    expect(result.remainingAfter[stage].maxEventLoopGapMs).toBeLessThan(result.remainingBefore[stage].maxEventLoopGapMs * 0.9);
  }
  expect(result.compressedBytes).toBeGreaterThan(0); // decode must not detach the cache's input buffer.
  expect(result.after.records.maxEventLoopGapMs).toBeLessThan(result.before.records.maxEventLoopGapMs * 0.8);
  expect(result.after.compare.maxEventLoopGapMs).toBeLessThan(result.before.compare.maxEventLoopGapMs * 0.8);
});

test('message conflicts share a chat and review highlights remain until acknowledged', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByText('すべてスキップ', { exact: true }).click();
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    const store = (await import('/src/store/store.ts')).default;
    const { toRecords, fromRecords, hashRecords } = await import('/src/store/storage/google/records.ts');
    const { mergeSyncRecords } = await import('/src/store/storage/google/merge.ts');
    const { markSyncChanges } = await import('/src/store/storage/google/conflicts.ts');
    const { addContent } = await import('/src/utils/contentStore.ts');
    const { materializeActivePath } = await import('/src/utils/branchUtils.ts');
    const { createPartializedState, createPersistedChatDataState } = await import('/src/store/persistence.ts');
    const { saveChatData } = await import('/src/store/storage/IndexedDbStorage.ts');
    const { STORE_VERSION } = await import('/src/store/version.ts');
    const original = { state: structuredClone(createPartializedState(store.getState())), version: STORE_VERSION };
    original.state.chats = [original.state.chats![0]];
    const chat = original.state.chats[0]; chat.title = 'Message merge review'; chat.folder = 'review-folder';
    original.state.folders = { 'review-folder': { id: 'review-folder', name: 'Review folder', expanded: true, order: 0 } };
    const texts = ['Merge root', 'Original message', 'Shared continuation'];
    chat.branchTree = { rootId: 'a', activePath: ['a', 'b', 'c'], nodes: {} };
    for (const [index, id] of ['a', 'b', 'c'].entries()) chat.branchTree.nodes[id] = {
      id, parentId: index ? ['a', 'b'][index - 1] : null, role: 'user', createdAt: index,
      contentHash: addContent(original.state.contentStore!, [{ type: 'text', text: texts[index] }]),
    };
    const local = structuredClone(original), remote = structuredClone(original);
    local.state.chats![0].branchTree!.nodes.b.contentHash = addContent(local.state.contentStore!, [{ type: 'text', text: 'Local message version' }]);
    remote.state.chats![0].branchTree!.nodes.b.contentHash = addContent(remote.state.contentStore!, [{ type: 'text', text: 'Cloud message version' }]);
    const merged = await fromRecords(await mergeSyncRecords(await hashRecords(await toRecords(original)), await toRecords(local), await toRecords(remote)));
    for (const chat of merged.state.chats!) chat.messages = materializeActivePath(chat.branchTree!, merged.state.contentStore!);
    store.setState({ ...merged.state, currentChatIndex: 0, chatActiveView: 'chat' });
    await markSyncChanges(local, merged);
    await saveChatData(createPersistedChatDataState(store.getState()));
  });
  await expect(page.getByText('Local message version', { exact: true })).toBeVisible();
  await expect(page.locator('[data-sync-node-changed="true"]')).not.toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Local message version', { exact: true })).toBeVisible();
  await expect(page.locator('[data-sync-node-changed="true"]')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Previous branch', exact: true }).click();
  await expect(page.getByText('Cloud message version', { exact: true })).toBeVisible();
  await expect(page.getByText('Shared continuation', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('message-merge-highlight.png') });
  await page.getByRole('button', { name: '分岐エディタ', exact: true }).click();
  await expect(page.locator('.react-flow__node [data-sync-node-changed="true"]')).not.toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('branch-merge-highlight.png') });
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: '同期の変更を確認済みにする', exact: true }).first().click();
  await page.getByRole('button', { name: 'このチャットを確認済みにする', exact: true }).click();
  await expect(page.locator('[data-sync-node-changed="true"]')).toHaveCount(0);
  await expect(page.locator('a[data-sync-changed="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'フォルダーの変更を確認済みにする', exact: true }).click();
  await expect(page.locator('div[data-sync-changed="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (await import('/src/store/storage/IndexedDbStorage.ts')).loadChatData())?.chats[0].branchTree?.activePath[1])).toBe('b');
  await page.reload();
  await expect(page.getByText('Cloud message version', { exact: true })).toBeVisible();
  await expect(page.locator('[data-sync-node-changed="true"]')).toHaveCount(0);
});

test('history compaction restores from Drive packs using real Workers and IndexedDB', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { EncryptedDriveSync } = await import('/src/store/storage/google/sync.ts');
    const { DriveNotFoundError, SYNC_FOLDER_TYPE } = await import('/src/store/storage/google/transport.ts');
    const { encode, encrypt, digest } = await import('/src/store/storage/google/crypto.ts');
    const { rememberedSyncKey } = await import('/src/store/storage/google/cache.ts');
    const { toRecords } = await import('/src/store/storage/google/records.ts');
    const files = new Map<string, { bytes: Uint8Array; metadata: any }>();
    const events: any[] = [];
    const reads: string[] = [];
    let next = 0;
    const prefix = crypto.randomUUID();
    const list = (dataset: string, kind: string) => [...files.values()].filter(f =>
      f.metadata.appProperties?.dataset === dataset && f.metadata.appProperties.kind === kind).map(f => f.metadata.id);
    const drive = {
      async ids(count: number) { return Array.from({ length: count }, () => `${prefix}-${++next}`); },
      async folder(id: string, headerId: string) {
        const metadata = { id, mimeType: SYNC_FOLDER_TYPE, appProperties: { weaveletSync: '1', headerId } };
        files.set(id, { bytes: new Uint8Array(), metadata }); return metadata;
      },
      async metadata(id: string) { return files.get(id)!.metadata; },
      async put(id: string, dataset: string, kind: string, bytes: Uint8Array) {
        const metadata = { id, appProperties: { dataset, kind } };
        files.set(id, { bytes: bytes.slice(), metadata }); events.push({ fileId: id, file: metadata });
      },
      async read(id: string) { reads.push(id); if (!files.has(id)) throw new DriveNotFoundError('404'); return files.get(id)!.bytes.slice(); },
      async startToken() { return String(events.length); },
      async changes(token: string) { return { token: String(events.length), changes: events.slice(Number(token)) }; },
      async commits(dataset: string) { return list(dataset, 'commit'); },
      async packs(dataset: string) { return list(dataset, 'pack'); },
      async remove(id: string) { if (files.delete(id)) events.push({ fileId: id, removed: true }); },
    };
    const state = { version: 18, state: { chats: [{ id: 'chat', title: 'initial', messages: [{ role: 'user',
      content: [{ type: 'text', text: 'retained message' }] }] }], contentStore: {}, theme: 'dark' } };
    const { session, file } = await EncryptedDriveSync.create(drive, 'browser compaction test password');
    await session.push(state, true);
    let parent = (await drive.commits(file.id))[0];
    const key = (await rememberedSyncKey(file.id))!;
    for (let i = 0; i < 127; i++) {
      const [id] = await drive.ids(1);
      const before = await digest(JSON.stringify(state.state.chats[0].title));
      state.state.chats[0].title = `edit-${i}`;
      const commit = { version: 2, parents: [parent], changes: [{ key: '["chats","chat","title"]', before,
        after: JSON.stringify(state.state.chats[0].title) }] };
      await drive.put(id, file.id, 'commit', await encrypt(key, encode(commit), `${file.id}:${id}`)); parent = id;
    }
    await session.push(state, true);
    const rawFiles = (await drive.commits(file.id)).length;
    const packFiles = (await drive.packs(file.id)).length;
    reads.length = 0;
    await session.pull();
    const cachedReads = reads.length;
    session.close();
    // Simulate a fresh history cache while keeping the actual non-extractable remembered key.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('weavelet-google-sync', 3);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').delete(file.id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    });
    const reader = new EncryptedDriveSync(file.id, drive);
    await reader.restoreKey();
    reads.length = 0;
    const restored = await reader.pull();
    return { rawFiles, packFiles, cachedReads, freshReads: reads.length,
      equal: JSON.stringify(await toRecords(restored)) === JSON.stringify(await toRecords(state)) };
  });
  expect(result).toEqual({ rawFiles: 0, packFiles: 1, cachedReads: 0, freshReads: 2, equal: true });
});
