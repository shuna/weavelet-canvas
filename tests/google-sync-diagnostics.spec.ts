import { test, expect } from '@playwright/test';

test.use({ headless: true, hasTouch: true, locale: 'ja-JP', baseURL: process.env.WEAVELET_TEST_URL ?? 'http://localhost:5189',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('shows measured sync costs, compaction and an explicitly estimated reference in the debug panel', async ({ page }) => {
  await page.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken:()=>{}}),revoke:()=>{}}}};' }));
  await page.goto('/');
  await page.getByText('すべてスキップ', { exact: true }).click();
  await page.getByRole('button', { name: 'close modal', exact: true }).click();
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/store.ts');
    const { withSyncProgress, beginTransfer } = await import('/src/store/storage/google/progress.ts');
    const { reportCompaction, reportSyncHistory } = await import('/src/store/storage/google/diagnostics.ts');
    store.getState().setShowDebugPanel(true);
    await withSyncProgress(async () => {
      beginTransfer('upload')(512);
      beginTransfer('upload', 'compaction')(4 * 1024 * 1024);
      beginTransfer('download', 'verification')(4 * 1024 * 1024);
      reportCompaction({ status: 'completed', sourceFiles: 129, newFiles: 2 });
      reportSyncHistory({ unaggregated: 128, threshold: 128, partBytes: 4 * 1024 * 1024,
        packs: [{ bytes: 400, parts: 1 }, { bytes: 600, parts: 1 }], cleanupTargets: 0 });
    });
  });
  const view = page.getByTestId('google-sync-diagnostics');
  await view.locator('summary').first().click();
  await expect(view.getByRole('heading', { name: '通信', exact: true })).toBeVisible();
  await expect(view.getByRole('heading', { name: '処理時間（累計）', exact: true })).toBeVisible();
  await expect(view.getByRole('heading', { name: '集約', exact: true })).toBeVisible();
  await expect(view).toContainText('対象元ファイル 129 → 新規 2 / 127削減');
  await expect(view.locator('table')).not.toBeVisible();
  await view.getByText('通信内訳', { exact: true }).click();
  await expect(view.locator('tr').filter({ has: page.getByRole('rowheader', { name: '集約', exact: true }) })).toContainText('4.00 MiB');
  await expect(view.locator('tr').filter({ has: page.getByRole('rowheader', { name: '削除前の検証', exact: true }) })).toContainText('4.00 MiB');
  await view.getByText('履歴とファイル構成', { exact: true }).click();
  await expect(view.locator('dl').last()).toContainText('128 / 128件');
  await expect(view.getByText('本体の参考最小数（推定）', { exact: true })).toBeVisible();
  await expect(view.getByText('参考最小数との差（ファイル）', { exact: true })).toBeVisible();
  await expect(view.getByText(/HTTPヘッダー、失敗した転送は含みません/)).toHaveCount(0);
  const info = view.getByRole('button', { name: 'Info', exact: true });
  const tooltip = page.getByRole('tooltip');
  const height = await view.evaluate(element => element.getBoundingClientRect().height);
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await info.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('HTTPヘッダー、失敗した転送は含みません');
  expect(await view.evaluate(element => element.getBoundingClientRect().height)).toBe(height);
  expect(await tooltip.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight;
  })).toBe(true);
  await view.getByRole('heading', { name: '通信', exact: true }).hover();
  await expect(tooltip).toHaveCount(0);
  await info.tap();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('全体の最適値ではありません');
  await page.screenshot({ path: 'test-results/google-sync-details-info.png' });
  await view.getByRole('heading', { name: '通信', exact: true }).tap();
  await expect(tooltip).toHaveCount(0);
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(tooltip).toHaveCount(0);
  await view.screenshot({ path: 'test-results/google-sync-details.png' });
});
