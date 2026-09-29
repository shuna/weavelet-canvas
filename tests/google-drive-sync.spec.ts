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
      const commitQuery = url.searchParams.get('q')?.includes("key='kind'");
      const listed = [...files.values()].filter(({ metadata }) => commitQuery
        ? metadata.appProperties?.kind === 'commit'
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
