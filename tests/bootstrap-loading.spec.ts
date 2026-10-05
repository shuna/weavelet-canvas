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
    const request = navigator.locks.request.bind(navigator.locks);
    const gate = new Promise<void>(resolve => { (window as any).releaseBootstrap = resolve; });
    (navigator.locks as any).request = async (name: string, ...args: any[]) => {
      if (name === 'weavelet-canvas:persisted-state:mutation') await gate;
      return (request as any)(name, ...args);
    };
  });
  await page.reload();
  const loading = page.getByTestId('bootstrap-loading');
  await expect(loading).toBeVisible();
  await expect(loading.getByRole('status')).toHaveText('保存された会話を読み込んでいます…');
  await expect(page.getByTestId('bootstrap-waiting')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/bootstrap-loading.png' });
  await page.evaluate(() => (window as any).releaseBootstrap());
  await expect(loading).toHaveCount(0);
  await expect(page.locator('#boot-status')).toHaveCount(0);
});
