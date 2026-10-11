import { test, expect } from '@playwright/test';

test.use({ headless: true, baseURL: 'http://127.0.0.1:5175',
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE } });

test('real OPFS file removal stops an open writer before deleting', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const storage = await import(/* @vite-ignore */ '/src/local-llm/storage.ts');
    const id = `refactor-test-${crypto.randomUUID()}`;
    await storage.saveFile(id, 'complete.bin', new Blob(['complete']));
    const writer = await storage.createOPFSWritable(id, 'pending.bin');
    await writer.write(new Uint8Array([1, 2, 3]));
    const removed = await storage.removeAssets(id);
    const ids = await storage.listSavedModelIds();
    let rejectsLateWrite = false;
    try { await writer.write(new Uint8Array([4])); } catch { rejectsLateWrite = true; }
    return { status: removed.status, absent: !ids.includes(id), rejectsLateWrite };
  });
  expect(result).toEqual({ status: 'removed', absent: true, rejectsLateWrite: true });
});
