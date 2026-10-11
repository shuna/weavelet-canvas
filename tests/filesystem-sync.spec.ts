import { test, expect } from '@playwright/test';
test.use({ headless: true, locale: 'ja-JP', baseURL: process.env.WEAVELET_TEST_URL ?? 'http://localhost:5188',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('folder UI saves encrypted deltas and restores the native handle after reload', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByText('すべてスキップ', { exact: true }).click();
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('test-sync', { create: true });
    // Real browser handles and IndexedDB; OPFS substitutes only the interactive OS picker.
    window.showDirectoryPicker = async () => directory;
  });
  await page.getByText('クラウド同期', { exact: false }).click();
  await page.getByRole('button', { name: 'フォルダーで同期', exact: true }).click();
  await page.getByRole('textbox', { name: 'フォルダー同期パスフレーズ', exact: true }).fill('browser-test passphrase');
  await page.getByRole('textbox', { name: 'フォルダー同期パスフレーズの確認', exact: true }).fill('browser-test passphrase');
  await page.getByRole('button', { name: '保存先フォルダーを選択', exact: true }).click();
  await expect(page.getByText('フォルダーへ保存済み', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const chats = structuredClone(store.getState().chats!);
    chats[0].title = 'folder persisted title';
    store.getState().setChats(chats);
  });
  await expect.poll(() => page.evaluate(async () => {
    const { savedFileSystemTarget } = await import('/src/store/storage/filesystem/handleStore.ts');
    const saved = await savedFileSystemTarget();
    let commits = 0;
    for await (const entry of saved!.handle.values()) if (entry.name.endsWith('.commit.bin')) commits++;
    return commits;
  }), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('フォルダーへ保存済み', { exact: true })).toBeVisible();
  const names = await page.evaluate(async () => {
    const { savedFileSystemTarget } = await import('/src/store/storage/filesystem/handleStore.ts');
    const saved = await savedFileSystemTarget();
    const names: string[] = [];
    for await (const entry of saved!.handle.values()) {
      names.push(entry.name);
      if (entry.kind === 'file' && entry.name.endsWith('.bin')) {
        if ((await (await (entry as FileSystemFileHandle).getFile()).text()).includes('folder persisted title')) throw new Error('plaintext leaked');
      }
    }
    return names;
  });
  expect(names).toContain('weavelet-sync.json');
  expect(names.filter(name => name.endsWith('.commit.bin')).length).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    return auth.getState().syncStatus;
  }), { timeout: 20000 }).toBe('synced');
  expect(await page.evaluate(async () => {
    const { savedFileSystemTarget } = await import('/src/store/storage/filesystem/handleStore.ts');
    const target = await savedFileSystemTarget();
    return { name: target!.handle.name, initialized: target!.initialized, permission: await target!.handle.queryPermission({ mode: 'readwrite' }) };
  })).toEqual({ name: 'test-sync', initialized: true, permission: 'granted' });
  await page.addInitScript(() => {
    const original = FileSystemHandle.prototype.queryPermission;
    FileSystemHandle.prototype.queryPermission = async function(options) {
      return localStorage.getItem('test-permission') === 'prompt' ? 'prompt' : original.call(this, options);
    };
    FileSystemHandle.prototype.requestPermission = async function() {
      localStorage.setItem('test-permission', 'granted'); return 'granted';
    };
  });
  await page.evaluate(() => localStorage.setItem('test-permission', 'prompt'));
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const { default: auth } = await import('/src/store/cloud-auth-store.ts');
    return auth.getState().syncStatus;
  })).toBe('unauthenticated');
  await page.getByText('クラウド同期', { exact: false }).click();
  await page.getByRole('button', { name: 'アクセスを許可して再開', exact: true }).click();
  await expect(page.getByText('フォルダーへ保存済み', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { disconnectFileSystemSync } = await import('/src/store/storage/FileSystemSync.ts');
    const { savedFileSystemTarget } = await import('/src/store/storage/filesystem/handleStore.ts');
    const saved = await savedFileSystemTarget();
    await disconnectFileSystemSync();
    const { EncryptedSync } = await import('/src/store/storage/sync/EncryptedSync.ts');
    const { FileSystemTransport } = await import('/src/store/storage/filesystem/transport.ts');
    const reader = new EncryptedSync(saved!.dataset, new FileSystemTransport(saved!.handle));
    await reader.unlock('browser-test passphrase');
    if ((await reader.pull()).state.chats![0].title !== 'folder persisted title') throw new Error('delta was not saved');
    reader.close();
  });
  expect(await page.evaluate(async () => {
    const { savedFileSystemTarget } = await import('/src/store/storage/filesystem/handleStore.ts');
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('test-sync');
    await directory.getFileHandle('weavelet-sync.json');
    return (await savedFileSystemTarget()) === undefined;
  })).toBe(true);
});
