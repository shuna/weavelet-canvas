import { test, expect } from '@playwright/test';

test.use({ headless: true, locale: 'ja-JP', baseURL: process.env.WEAVELET_TEST_URL ?? 'http://localhost:5189',
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
  await view.locator('summary').click();
  await expect(view).toContainText('集約の送信: 4.00 MiB / 削除前の検証受信: 4.00 MiB');
  await expect(view).toContainText('対象元ファイル 129 → 新規 2 / 127削減');
  await expect(view).toContainText('未集約 128 / 閾値 128件 · 基準超過 1件');
  await expect(view).toContainText('本体の参考最小数 1 / 現状との差 1ファイル（推定）');
  await expect(view).toContainText('全体の最適値ではありません');
  await expect(view).toContainText('HTTPヘッダー、失敗した転送は含みません');
});
