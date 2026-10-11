import { test, expect } from '@playwright/test';

test.use({ headless: true, locale: 'ja-JP' });

test('shows loading status during a slow local restore and removes it when ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-status')).toHaveCount(0);
  await expect(page.getByTestId('bootstrap-loading')).toHaveCount(0);
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { saveChatData } = await import('/src/store/storage/IndexedDbStorage.ts');
    const { createPersistedChatDataState } = await import('/src/store/persistence.ts');
    await saveChatData(createPersistedChatDataState(store.getState()));
  });
  await page.addInitScript(() => {
    const gate = new Promise<void>(resolve => { (window as any).releaseBootstrap = resolve; });
    void navigator.locks.request('weavelet-canvas:persisted-state:mutation', () => gate);
  });
  await page.reload();
  const loading = page.getByTestId('bootstrap-loading');
  await expect(loading).toBeVisible();
  await expect(loading.getByRole('status')).toHaveText('別の画面による保存処理の完了を待っています…');
  await expect(page.getByTestId('bootstrap-waiting')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/bootstrap-loading.png' });
  await page.evaluate(() => (window as any).releaseBootstrap());
  await expect(loading).toHaveCount(0);
  await expect(page.locator('#boot-status')).toHaveCount(0);
});

test('shows chat counts while decompressing saved chats', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('bootstrap-loading')).toHaveCount(0);
  await page.evaluate(async () => {
    const { saveChatData, compressSingleChat } = await import('/src/store/storage/IndexedDbStorage.ts');
    const chats = Array.from({ length: 100 }, (_, index) => ({
      id: `progress-${index}`, title: `Chat ${index}`, titleSet: true, imageDetail: 'auto',
      config: { model: 'gpt-4o' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    }));
    await saveChatData({ chats, contentStore: {}, branchClipboard: null });
    for (const chat of chats) await compressSingleChat(chat.id);
  });
  await page.addInitScript(() => {
    const Native = DecompressionStream;
    (window as any).DecompressionStream = class extends Native {
      get readable() {
        return super.readable.pipeThrough(new TransformStream({
          async transform(chunk, controller) {
            await new Promise(resolve => setTimeout(resolve, 20));
            controller.enqueue(chunk);
          },
        }));
      }
    };
  });
  await page.reload();
  const progress = page.getByTestId('bootstrap-progress');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText(/処理済み：\d+チャット \/ 全100チャット/);
  await expect(progress.locator('progress')).toHaveAttribute('max', '100');
  await page.screenshot({ path: 'test-results/bootstrap-chat-progress.png' });
  await expect(page.getByTestId('bootstrap-loading')).toHaveCount(0);
  expect(await page.evaluate(async () => (await import('/src/store/store.ts')).default.getState().chats?.length)).toBe(100);
});

test('ends a stalled lock wait with a recovery notice and preserves stored chats', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('bootstrap-loading')).toHaveCount(0);
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { saveChatData } = await import('/src/store/storage/IndexedDbStorage.ts');
    const { createPersistedChatDataState } = await import('/src/store/persistence.ts');
    await saveChatData(createPersistedChatDataState(store.getState()));
  });
  await page.addInitScript(() => {
    const gate = new Promise<void>(resolve => { (window as any).releaseBootstrap = resolve; });
    void navigator.locks.request('weavelet-canvas:persisted-state:mutation', () => gate);
  });
  await page.clock.install();
  await page.reload();
  await expect(page.getByTestId('bootstrap-loading').getByRole('status')).toHaveText('別の画面による保存処理の完了を待っています…');
  await page.clock.runFor(31_000);
  await expect(page.getByTestId('bootstrap-loading')).toHaveCount(0);
  await expect(page.getByText('会話データの安全な読み込みに失敗しました')).toBeVisible();
  await expect(page.getByText(/詳細: 別の画面の保存処理が30秒以内に完了しませんでした/)).toBeVisible();
  expect(await page.evaluate(async () => {
    const { areChatDataWritesBlocked } = await import('/src/store/storage/IndexedDbStorage.ts');
    return areChatDataWritesBlocked();
  })).toBe(true);
  expect(await page.evaluate(async () => {
    const request = indexedDB.open('weavelet-canvas', 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const read = db.transaction('persisted-state', 'readonly').objectStore('persisted-state').get('meta');
    const meta = await new Promise<any>(resolve => { read.onsuccess = () => resolve(read.result); });
    db.close();
    return meta.chatIds.length;
  })).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).releaseBootstrap());
});
