import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

// Start Vite with VITE_GOOGLE_CLIENT_ID=sidebar-ui-test; no credentials or network sync are used.
test('sync banner waits ten seconds, cancels short checks, and shows errors immediately', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { default: auth } = await load('/src/store/cloud-auth-store.ts');
    store.setState({ onboardingCompleted: 1 });
    auth.setState({ provider: 'google', cloudSync: true, syncStatus: 'synced', googleAccessToken: undefined });
  });
  const status = page.getByRole('button', { name: /Google Drive:.*同期の詳細を開く/ });
  await expect(status).toBeVisible();
  await page.clock.install();
  const setStatus = async (syncStatus: string) => {
    await page.evaluate(async syncStatus => {
      const path = '/src/store/cloud-auth-store.ts';
      const { default: auth } = await import(/* @vite-ignore */ path);
      auth.setState({ syncStatus });
    }, syncStatus);
    await expect(status).toHaveAttribute('aria-label', new RegExp(
      syncStatus === 'syncing' ? '同期中' : syncStatus === 'error' ? '同期失敗' : '同期済み'));
  };
  const banner = page.locator('[data-google-sync-banner]');
  for (let i = 0; i < 2; i++) {
    await setStatus('syncing');
    await page.clock.runFor(9000);
    await expect(banner).toHaveCount(0);
    await setStatus('synced');
    await page.clock.runFor(2000);
    await expect(banner).toHaveCount(0);
  }
  await setStatus('syncing');
  await page.clock.runFor(5000);
  await status.click();
  const close = page.getByRole('button', { name: 'close modal', exact: true });
  await expect(close).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/store/storage/google/progress.ts';
    const { useGoogleSyncProgress } = await import(/* @vite-ignore */ path);
    useGoogleSyncProgress.setState({ active: true, phase: 'downloading' });
  });
  await page.clock.runFor(5000);
  await expect(banner).toHaveCount(0);
  await close.click();
  await expect(banner).toBeVisible();
  await setStatus('synced');
  await expect(banner).toHaveCount(0);
  await setStatus('syncing');
  await expect(banner).toHaveCount(0);
  await page.clock.runFor(9999);
  await expect(banner).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(banner).toBeVisible();
  await setStatus('synced');
  await expect(banner).toHaveCount(0);
  await setStatus('error');
  await expect(banner).toBeVisible();
});
