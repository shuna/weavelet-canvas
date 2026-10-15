import { test, expect } from '@playwright/test';

test.use({ headless: true, locale: 'ja-JP', baseURL: 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('shows history counts and receives real Worker progress for a deep history', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('https://accounts.google.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken:()=>{}}),revoke:()=>{}}}};',
  }));
  await page.goto('/');
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: store } = await load('/src/store/store.ts');
    const { default: auth } = await load('/src/store/cloud-auth-store.ts');
    store.setState({ onboardingCompleted: 1 });
    auth.setState({ provider: 'google', cloudSync: true, syncStatus: 'syncing' });
    const { useGoogleSyncProgress, syncHistoryProgress } = await load('/src/store/storage/google/progress.ts');
    useGoogleSyncProgress.setState({ active: true });
    syncHistoryProgress({ step: 'scanning', completed: 123 });
  });
  await page.getByRole('button', { name: /Google Drive:.*同期の詳細を開く/ }).click();
  const progress = page.getByTestId('google-sync-progress');
  await expect(progress).toContainText('123 件確認済み（総数を確認中）');
  await expect(progress.getByRole('progressbar').nth(1)).not.toHaveAttribute('value');
  await page.evaluate(async () => {
    const path = '/src/store/storage/google/progress.ts';
    const { syncHistoryProgress } = await import(/* @vite-ignore */ path);
    syncHistoryProgress({ step: 'replaying', completed: 10000, total: 20000 });
  });
  await expect(progress).toContainText('同期履歴の変更を適用しています — 50%');
  await expect(progress).toContainText('10000 / 20000 件処理済み');
  await expect(progress.getByRole('progressbar').nth(1)).toHaveAttribute('value', '50');

  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { replayHistoryAsync } = await load('/src/store/storage/google/processing.ts');
    const { useGoogleSyncProgress, withSyncProgress } = await load('/src/store/storage/google/progress.ts');
    useGoogleSyncProgress.setState({ active: false });
    const ids = Array.from({ length: 20000 }, (_, i) => String(i).padStart(5, '0'));
    const commits = Object.fromEntries(ids.map((id, i) => [id, {
      version: 1, parents: i ? [ids[i - 1]] : [], changes: [],
    }]));
    const steps = new Set<string>();
    let ticks = 0;
    const unsubscribe = useGoogleSyncProgress.subscribe((state: any) => {
      if (state.historyProgress) steps.add(state.historyProgress.step);
    });
    const timer = setInterval(() => { ticks++; }, 10);
    try {
      const value = await withSyncProgress(() => replayHistoryAsync({ commits, tips: [ids.at(-1)!] }));
      return { value, steps: [...steps], ticks, progress: useGoogleSyncProgress.getState().overallProgress };
    } finally { unsubscribe(); clearInterval(timer); }
  });
  expect(result.value).toEqual({ records: {}, conflicts: {} });
  expect(result.steps).toEqual(['scanning', 'replaying', 'resolving']);
  expect(result.ticks).toBeGreaterThan(0);
  expect(result.progress).toBe(1);
  await expect(progress).toHaveCount(0);
});
