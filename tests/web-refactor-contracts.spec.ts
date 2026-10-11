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

test('old remote data survives restart and is removed only after explicit import saves', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const initial = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const source = await (await fetch('/src/store/storage/applyExternalSnapshot.ts')).text();
    const storePath = source.match(/import useStore from ['"]([^'"]+)['"]/)![1];
    const { default: store } = await load(storePath);
    const { generateDefaultChat } = await load('/src/constants/chat.ts');
    const { applyExternalSnapshot } = await load('/src/store/storage/applyExternalSnapshot.ts');
    const { loadLegacyRemoteSnapshots } = await load('/src/store/storage/IndexedDbStorage.ts');
    const chat = { ...generateDefaultChat('Old remote fixture'), branchTree: undefined,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'legacy recovered' }] }] };
    const before = store.getState().chats;
    let refused = false; let errorMessage;
    try { await applyExternalSnapshot({ chats: [chat] }, () => true, store.getState(), 17); }
    catch (error) { errorMessage = String(error); refused = errorMessage.includes('preserved'); }
    const records = await loadLegacyRemoteSnapshots();
    if (!refused) throw new Error(`Legacy snapshot unexpectedly accepted or failed: ${errorMessage}`);
    return { refused, unchanged: store.getState().chats === before, count: records.length, version: records[0]?.snapshot.version };
  });
  expect(initial).toEqual({ refused: true, unchanged: true, count: 1, version: 17 });
  await page.reload({ waitUntil: 'networkidle' });
  const recovered = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const source = await (await fetch('/src/store/storage/applyExternalSnapshot.ts')).text();
    const storePath = source.match(/import useStore from ['"]([^'"]+)['"]/)![1];
    const { default: store } = await load(storePath);
    const { loadLegacyRemoteSnapshots } = await load('/src/store/storage/IndexedDbStorage.ts');
    const { importChatFromFile } = await load('/src/components/ImportExportChat/importService.ts');
    const records = await loadLegacyRemoteSnapshots();
    const shownAfterRestart = store.getState().migrationUiState?.legacyRemoteSnapshots?.length === 1;
    const file = new File([JSON.stringify(records[0].snapshot)], 'legacy.json', { type: 'application/json' });
    const result = await importChatFromFile(file, (key: string) => key, 'append');
    return { shownAfterRestart, success: result.success, remaining: (await loadLegacyRemoteSnapshots()).length,
      imported: store.getState().chats.some((chat: any) => chat.messages.some((message: any) => message.content.some((part: any) => part.text === 'legacy recovered'))) };
  });
  expect(recovered).toEqual({ shownAfterRestart: true, success: true, remaining: 0, imported: true });
});
